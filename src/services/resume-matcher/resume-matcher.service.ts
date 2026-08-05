import { randomUUID } from 'crypto';
import type { ExtractionInput, ExtractionOutput, ExtractedField } from '../recruiter-intelligence/ai/types';
import { pipeline } from '../recruiter-intelligence/ai/pipeline.factory';
import { TokenOverlapMatcher } from './embeddings';
import type { MatchScore, ParsedJob, ParsedResume } from './models';
import { factService } from '../fact.service';
import { snapshotService } from '../snapshot.service';
import { logger } from '../../lib/logger';
import { documentExtractionService } from '../document/document-extraction.service';

export class ResumeMatcherService {
  private tokenOverlapMatcher: TokenOverlapMatcher;

  constructor() {
    this.tokenOverlapMatcher = new TokenOverlapMatcher();
  }

  public async extractTextFromBuffer(buffer: Buffer, mimetype: string): Promise<string> {
    const { rawText } = await documentExtractionService.extract(buffer, mimetype);
    return rawText;
  }

  public async parseResume(text: string): Promise<ParsedResume> {
    const output = await this.extractResume(text);
    return this.buildParsedResume(output);
  }

  public async parseJobDescription(text: string): Promise<ParsedJob> {
    const output = await this.extractResume(text);
    return this.buildParsedJob(output);
  }

  public async scoreMatch(resumeText: string, jobText: string): Promise<MatchScore> {
    const parsedResume = await this.parseResume(resumeText);
    const parsedJob = await this.parseJobDescription(jobText);

    let skillScoreSum = 0;
    const missingSkills: string[] = [];

    for (const reqSkill of parsedJob.skills) {
      let bestMatch = 0;
      for (const resSkill of parsedResume.skills) {
        const score = await this.tokenOverlapMatcher.scoreSimilarity(reqSkill, resSkill);
        if (score > bestMatch) bestMatch = score;
      }

      skillScoreSum += bestMatch;

      if (bestMatch < 0.7) {
        missingSkills.push(reqSkill);
      }
    }

    const skillMatch = parsedJob.skills.length > 0 ? skillScoreSum / parsedJob.skills.length : 1.0;

    let techScoreSum = 0;
    for (const reqTech of parsedJob.technologies) {
      let bestMatch = 0;
      for (const resTech of parsedResume.technologies) {
        const score = await this.tokenOverlapMatcher.scoreSimilarity(reqTech, resTech);
        if (score > bestMatch) bestMatch = score;
      }
      techScoreSum += bestMatch;
      if (bestMatch < 0.7) missingSkills.push(reqTech);
    }

    const techMatch =
      parsedJob.technologies.length > 0 ? techScoreSum / parsedJob.technologies.length : 1.0;

    let occupationScoreSum = 0;
    for (const reqOcc of parsedJob.occupations) {
      let bestMatch = 0;
      for (const resOcc of parsedResume.occupations) {
        const score = await this.tokenOverlapMatcher.scoreSimilarity(reqOcc, resOcc);
        if (score > bestMatch) bestMatch = score;
      }
      occupationScoreSum += bestMatch;
    }
    const occupationMatch =
      parsedJob.occupations.length > 0 ? occupationScoreSum / parsedJob.occupations.length : 1.0;

    const explicitExperience = parsedResume.experience.filter(
      (exp) => exp.years > 0,
    );
    const totalExpYears = explicitExperience.reduce((sum, exp) => sum + exp.years, 0);
    const experienceMatch =
      parsedJob.minExperience > 0 ? Math.min(totalExpYears / parsedJob.minExperience, 1.0) : 1.0;

    const overallScore =
      skillMatch * 0.35 + techMatch * 0.25 + occupationMatch * 0.2 + experienceMatch * 0.2;

    const improvementSuggestions = [];
    if (missingSkills.length > 0) {
      improvementSuggestions.push(`Consider adding experience with: ${missingSkills.join(', ')}`);
    }
    if (occupationMatch < 1.0) {
      improvementSuggestions.push(
        'Resume occupation focus does not fully align with the target role.',
      );
    }
    if (experienceMatch < 1.0) {
      improvementSuggestions.push(
        `Highlight more relevant experience to meet the ${parsedJob.minExperience} year requirement.`,
      );
    }

    return {
      overallScore: Number(overallScore.toFixed(2)),
      skillMatch: Number(skillMatch.toFixed(2)),
      occupationMatch: Number(occupationMatch.toFixed(2)),
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
    experiences: Array<{
      role: string | null;
      company: string | null;
      dates: string | null;
      raw: string;
    }>;
    education: Array<{
      degree: string | null;
      field: string | null;
      institution: string | null;
      year: string | null;
      raw: string;
    }>;
    factIds: string[];
  }> {
    const text = await this.extractTextFromBuffer(input.fileBuffer, input.mimeType);
    const output = await this.extractResume(text);

    const skills = this.extractStringFields(output, 'skill');
    const experiences = this.extractExperienceFields(output);
    const education = this.extractEducationFields(output);
    const factIds = await this.storeFacts(
      input.userId,
      input.resumeVersionId,
      skills,
      experiences,
      education,
      text,
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

  private async extractResume(text: string): Promise<ExtractionOutput> {
    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: 'default',
      sourceType: 'document',
      sourceId: randomUUID(),
      content: text,
      metadata: {},
      requestedAt: new Date(),
    };

    const variables: Record<string, string> = {
      content: text,
    };

    return pipeline.extract('resume-extraction', input, variables);
  }

  private buildParsedResume(output: ExtractionOutput): ParsedResume {
    const skills = this.extractStringFields(output, 'skill');
    const technologies = this.extractStringFields(output, 'technology');
    const occupations = this.extractStringFields(output, 'occupation');
    const experiences = this.extractExperienceFields(output);
    const education = this.extractEducationFields(output);

    return {
      skills,
      technologies,
      occupations,
      experience: experiences,
      education,
      keywords: [...skills, ...technologies, ...occupations],
    };
  }

  private buildParsedJob(output: ExtractionOutput): ParsedJob {
    const skills = this.extractStringFields(output, 'skill');
    const technologies = this.extractStringFields(output, 'technology');
    const occupations = this.extractStringFields(output, 'occupation');
    const minExperience = this.inferMinimumExperience(output);

    return {
      requirements: [],
      skills,
      technologies,
      occupations,
      minExperience,
      keywords: [...skills, ...technologies, ...occupations],
    };
  }

  private extractStringFields(output: ExtractionOutput, fieldName: string): string[] {
    return output.fields
      .filter((f: ExtractedField) => f.field === fieldName)
      .map((f: ExtractedField) => (typeof f.value === 'string' ? f.value : ''))
      .filter((v: string) => v.length > 0);
  }

  private extractExperienceFields(output: ExtractionOutput): ParsedResume['experience'] {
    return output.fields.filter((f: ExtractedField) => f.field === 'experience').map((f: ExtractedField) => {
      const rawValue = f.rawValue;
      const value = f.value as Record<string, unknown> | undefined;
      const years = typeof value?.['years'] === 'number' ? value['years'] : 0;
      const role = typeof value?.['role'] === 'string' ? value['role'] : null;
      const company = typeof value?.['company'] === 'string' ? value['company'] : null;
      const dates = typeof value?.['dates'] === 'string' ? value['dates'] : null;
      return {
        role,
        company,
        dates,
        years,
        raw: rawValue,
      };
    });
  }

  private extractEducationFields(output: ExtractionOutput): ParsedResume['education'] {
    return output.fields.filter((f: ExtractedField) => f.field === 'education').map((f: ExtractedField) => {
      const rawValue = f.rawValue;
      const value = f.value as Record<string, unknown> | undefined;
      const degree = typeof value?.['degree'] === 'string' ? value['degree'] : null;
      const field = typeof value?.['field'] === 'string' ? value['field'] : null;
      const institution =
        typeof value?.['institution'] === 'string' ? value['institution'] : null;
      const year = typeof value?.['year'] === 'string' ? value['year'] : null;
      return {
        degree,
        field,
        institution,
        year,
        raw: rawValue,
      };
    });
  }

  private inferMinimumExperience(output: ExtractionOutput): number {
    const expField = output.fields.find((f: ExtractedField) => f.field === 'min_experience');
    if (expField && typeof expField.value === 'number') {
      return expField.value;
    }
    return 0;
  }

  private async storeFacts(
    userId: string,
    resumeVersionId: string,
    skills: string[],
    experiences: Array<{
      role: string | null;
      company: string | null;
      dates: string | null;
      raw: string;
    }>,
    education: Array<{
      degree: string | null;
      field: string | null;
      institution: string | null;
      year: string | null;
      raw: string;
    }>,
    rawText: string,
  ): Promise<string[]> {
    const factIds: string[] = [];
    const extractionRun = await factService.createExtractionRun({
      userId,
      sourceType: 'RESUME',
      sourceId: resumeVersionId,
      sourceVersion: '1',
      sourceIdentity: resumeVersionId,
      parserVersion: 'resume-matcher-v2',
      modelProvider: 'openrouter',
      modelVersion: 'ai-extraction',
      promptVersion: 'resume-extraction@1.0.0',
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
        extractionMethod: 'AI_EXTRACTION',
        modelVersion: 'ai-extraction',
        confidence: 0.85,
        evidenceReference: rawText,
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
        extractionMethod: 'AI_EXTRACTION',
        modelVersion: 'ai-extraction',
        confidence: 0.82,
        evidenceReference: exp.raw,
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
        extractionMethod: 'AI_EXTRACTION',
        modelVersion: 'ai-extraction',
        confidence: 0.8,
        evidenceReference: edu.raw,
        observedAt: new Date(),
      });
      factIds.push(fact.id);
    }

    return factIds;
  }
}

export const resumeMatcherService = new ResumeMatcherService();
