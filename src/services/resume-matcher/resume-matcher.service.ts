import * as pdfParse from 'pdf-parse';

import { SemanticMatcher } from './embeddings';
import type { MatchScore, ParsedJob, ParsedResume } from './models';
import { factService } from '../fact.service';
import { snapshotService } from '../snapshot.service';
import { logger } from '../../lib/logger';
import {
  getJobSkillLexicon,
  getResumeSkillLexicon,
} from '../../config/resume-lexicon';

const EXPERIENCE_PATTERNS = [
  /(.+?)\s+at\s+(.+?)\s*\((.+?)\)/i,
  /(.+?)\s*[-–—]\s*(.+?)\s*\((.+?)\)/i,
  /(\d{4})\s*[-–—]\s*(\d{4}|present|current)\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+)/i,
];

const EDUCATION_PATTERNS = [
  /\b(bachelor|b\.s\.?|b\.a\.?|master|m\.s\.?|m\.a\.?|ph\.d\.?|associate|diploma|certificate|mba|jd|md|dds|dvm)\b(?:\s+of|\s+in)?\s*([^,\n.]*)/i,
  /\b([^,\n.]+?)\b(?:\s+university|\s+college|\s+institute|\s+school)\b/i,
];

export class ResumeMatcherService {
  private semanticMatcher: SemanticMatcher;

  constructor() {
    this.semanticMatcher = new SemanticMatcher();
  }

  /**
   * Extracts raw text from a file buffer (e.g. PDF).
   */
  public async extractTextFromBuffer(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === 'application/pdf') {
      const parse = (pdfParse as any).default || pdfParse;
      const data = await parse(buffer);
      return data.text;
    }
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        // @ts-expect-error mammoth has no type declarations
        const mammothModule = await import('mammoth');
        const mammoth = mammothModule.default || mammothModule;
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      } catch (error) {
        logger.warn('[ResumeMatcher] DOCX extraction fallback used', {
          reason: error instanceof Error ? error.message : String(error),
        });
        return buffer.toString('utf-8');
      }
    }
    if (mimetype === 'text/plain') {
      return buffer.toString('utf-8');
    }
    // Fallback for plain text or unknown
    return buffer.toString('utf-8');
  }

  /**
   * Parses the raw resume text into a structured format.
   * In a real embedding/LLM world, you'd use a parser model here.
   * For now, we mock the extraction logic based on simple keyword finding.
   */
  public async parseResume(text: string): Promise<ParsedResume> {
    const lowerText = text.toLowerCase();
    const skills = await this.matchTerms(lowerText, await getResumeSkillLexicon());
    const technologies = skills;
    const experience = this.extractExperienceHints(text);
    const education = this.extractEducationHints(text);

    return {
      skills,
      technologies,
      experience,
      education,
      keywords: [...skills, ...technologies],
    };
  }

  /**
   * Parses the raw job description text.
   */
  public async parseJobDescription(text: string): Promise<ParsedJob> {
    const lowerText = text.toLowerCase();
    const skills = await this.matchTerms(lowerText, await getJobSkillLexicon());
    const technologies = skills;
    const minExperience = this.inferMinimumExperience(lowerText);

    return {
      requirements: [],
      skills,
      technologies,
      minExperience,
      keywords: [...skills, ...technologies],
    };
  }

  /**
   * Scores the resume against the job description.
   */
  public async scoreMatch(resumeText: string, jobText: string): Promise<MatchScore> {
    const parsedResume = await this.parseResume(resumeText);
    const parsedJob = await this.parseJobDescription(jobText);

    let skillScoreSum = 0;
    const missingSkills: string[] = [];

    // Semantic matching for skills
    for (const reqSkill of parsedJob.skills) {
      let bestMatch = 0;
      for (const resSkill of parsedResume.skills) {
        const score = await this.semanticMatcher.scoreSimilarity(reqSkill, resSkill);
        if (score > bestMatch) bestMatch = score;
      }

      skillScoreSum += bestMatch;

      // If no resume skill is > 0.7 similar, it's missing
      if (bestMatch < 0.7) {
        missingSkills.push(reqSkill);
      }
    }

    const skillMatch = parsedJob.skills.length > 0 ? skillScoreSum / parsedJob.skills.length : 1.0;

    // Semantic matching for technologies
    let techScoreSum = 0;
    for (const reqTech of parsedJob.technologies) {
      let bestMatch = 0;
      for (const resTech of parsedResume.technologies) {
        const score = await this.semanticMatcher.scoreSimilarity(reqTech, resTech);
        if (score > bestMatch) bestMatch = score;
      }
      techScoreSum += bestMatch;
      if (bestMatch < 0.7) missingSkills.push(reqTech);
    }

    const techMatch =
      parsedJob.technologies.length > 0 ? techScoreSum / parsedJob.technologies.length : 1.0;

    // Experience matching
    const totalExpYears = parsedResume.experience.reduce((sum, exp) => sum + exp.years, 0);
    let experienceMatch =
      parsedJob.minExperience > 0 ? Math.min(totalExpYears / parsedJob.minExperience, 1.0) : 1.0;

    // Combined overall score (Weighted: 40% skills, 30% tech, 30% experience)
    const overallScore = skillMatch * 0.4 + techMatch * 0.3 + experienceMatch * 0.3;

    const improvementSuggestions = [];
    if (missingSkills.length > 0) {
      improvementSuggestions.push(`Consider adding experience with: ${missingSkills.join(', ')}`);
    }
    if (experienceMatch < 1.0) {
      improvementSuggestions.push(
        `Highlight more relevant experience to meet the ${parsedJob.minExperience} year requirement.`,
      );
    }

    return {
      overallScore: Number(overallScore.toFixed(2)),
      skillMatch: Number(skillMatch.toFixed(2)),
      experienceMatch: Number(experienceMatch.toFixed(2)),
      missingSkills,
      improvementSuggestions,
    };
  }

  public async parseAndStoreResumeFacts(input: {
    userId: string;
    resumeVersionId: string;
    fileBuffer: Buffer;
    mimeType: string;
  }): Promise<{
    skills: string[];
    experiences: Array<{ role: string | null; company: string | null; dates: string | null; raw: string }>;
    education: Array<{ degree: string | null; field: string | null; institution: string | null; year: string | null; raw: string }>;
    factIds: string[];
  }> {
    const text = await this.extractTextFromBuffer(input.fileBuffer, input.mimeType);
    const skills = await this.detectSkills(text);
    const experiences = this.extractExperiences(text);
    const education = this.extractEducation(text);
    const factIds = await this.storeFacts(
      input.userId,
      input.resumeVersionId,
      skills,
      experiences,
      education,
    );

    try {
      await snapshotService.createSnapshot(
        input.userId,
        'RESUME_VERSION',
        input.resumeVersionId,
        `Snapshot after parsing resume ${input.resumeVersionId}`,
      );
    } catch (error) {
      logger.warn('[ResumeMatcher] Snapshot creation failed after parsing', {
        userId: input.userId,
        resumeVersionId: input.resumeVersionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { skills, experiences, education, factIds };
  }

  private async detectSkills(text: string): Promise<string[]> {
    const lowerText = text.toLowerCase();
    const found = new Set<string>();
    for (const skill of [...(await getResumeSkillLexicon())]) {
      if (this.termMatches(lowerText, skill)) {
        found.add(skill);
      }
    }
    return Array.from(found);
  }

  private async matchTerms(text: string, lexicon: string[]): Promise<string[]> {
    const found = new Set<string>();
    for (const term of lexicon) {
      if (this.termMatches(text, term)) {
        found.add(term);
      }
    }
    return Array.from(found);
  }

  private termMatches(text: string, term: string): boolean {
    if (!term) return false;
    const normalized = term.toLowerCase().trim();
    if (!normalized || normalized.length < 3) return false;
    if (text.includes(normalized)) return true;

    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    return pattern.test(text);
  }

  private extractExperienceHints(text: string): Array<{ role: string; years: number }> {
    const hints: Array<{ role: string; years: number }> = [];
    const lower = text.toLowerCase();
    if (/senior|lead|principal|staff/.test(lower)) {
      hints.push({ role: 'Senior Developer', years: 5 });
    }
    if (/developer|engineer|analyst|specialist/.test(lower) && !/senior|lead|principal|staff/.test(lower)) {
      hints.push({ role: 'Developer', years: 2 });
    }
    if (/manager|director|head/.test(lower)) {
      hints.push({ role: 'Manager', years: 7 });
    }
    if (hints.length === 0) {
      hints.push({ role: 'Developer', years: 2 });
    }
    return hints;
  }

  private extractEducationHints(text: string): string[] {
    const education: string[] = [];
    const lower = text.toLowerCase();
    for (const pattern of EDUCATION_PATTERNS) {
      const matches = text.match(pattern);
      if (matches?.[0]) {
        education.push(matches[0].trim());
      }
    }
    if (education.length === 0 && /bachelor|master|ph\.d|mba|associate|certificate/.test(lower)) {
      education.push('Education credential mentioned in resume');
    }
    return education;
  }

  private inferMinimumExperience(text: string): number {
    if (/senior|lead|principal|staff/.test(text)) return 5;
    if (/manager|director|head/.test(text)) return 7;
    return 2;
  }

  private extractExperiences(
    text: string,
  ): Array<{ role: string | null; company: string | null; dates: string | null; raw: string }> {
    const experiences: Array<{ role: string | null; company: string | null; dates: string | null; raw: string }> = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      for (const pattern of EXPERIENCE_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
          experiences.push({
            role: (match[1] ?? null)?.trim() || null,
            company: (match[2] ?? null)?.trim() || null,
            dates: (match[3] ?? null)?.trim() || null,
            raw: trimmed,
          });
          break;
        }
      }
    }
    return experiences;
  }

  private extractEducation(
    text: string,
  ): Array<{ degree: string | null; field: string | null; institution: string | null; year: string | null; raw: string }> {
    const education: Array<{ degree: string | null; field: string | null; institution: string | null; year: string | null; raw: string }> = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      for (const pattern of EDUCATION_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
          education.push({
            degree: (match[1] ?? null)?.trim() || null,
            field: (match[2] ?? null)?.trim() || null,
            institution: (match[2] ?? match[1] ?? null)?.trim() || null,
            year: null,
            raw: trimmed,
          });
          break;
        }
      }
    }
    return education;
  }

  private async storeFacts(
    userId: string,
    resumeVersionId: string,
    skills: string[],
    experiences: Array<{ role: string | null; company: string | null; dates: string | null; raw: string }>,
    education: Array<{ degree: string | null; field: string | null; institution: string | null; year: string | null; raw: string }>,
  ): Promise<string[]> {
    const factIds: string[] = [];
    const extractionRun = await factService.createExtractionRun({
      userId,
      sourceType: 'RESUME',
      sourceId: resumeVersionId,
      sourceVersion: '1',
      sourceIdentity: resumeVersionId,
      parserVersion: 'resume-matcher-v1',
      modelProvider: 'local',
      modelVersion: 'minimal-compat',
      promptVersion: 'n/a',
      schemaVersion: 'epic-4-prompt-3',
    });

    for (const skill of skills) {
      const fact = await factService.recordFact({
        userId,
        extractionRunId: extractionRun.runId,
        provenanceId: extractionRun.provenanceId,
        factType: 'SKILL',
        factData: { name: skill, source: 'resume_parser' },
        sourceType: 'RESUME',
        sourceId: resumeVersionId,
        sourceVersion: '1',
        extractionMethod: 'KEYWORD_MATCH',
        modelVersion: 'minimal-compat',
        confidence: 0.5,
        observedAt: new Date(),
      });
      factIds.push(fact.id);
    }

    for (const exp of experiences) {
      const fact = await factService.recordFact({
        userId,
        extractionRunId: extractionRun.runId,
        provenanceId: extractionRun.provenanceId,
        factType: 'EXPERIENCE',
        factData: exp,
        sourceType: 'RESUME',
        sourceId: resumeVersionId,
        sourceVersion: '1',
        extractionMethod: 'REGEX',
        modelVersion: 'minimal-compat',
        confidence: 0.4,
        observedAt: new Date(),
      });
      factIds.push(fact.id);
    }

    for (const edu of education) {
      const fact = await factService.recordFact({
        userId,
        extractionRunId: extractionRun.runId,
        provenanceId: extractionRun.provenanceId,
        factType: 'EDUCATION',
        factData: edu,
        sourceType: 'RESUME',
        sourceId: resumeVersionId,
        sourceVersion: '1',
        extractionMethod: 'REGEX',
        modelVersion: 'minimal-compat',
        confidence: 0.4,
        observedAt: new Date(),
      });
      factIds.push(fact.id);
    }

    return factIds;
  }
}

export const resumeMatcherService = new ResumeMatcherService();
