import * as pdfParse from 'pdf-parse';
import { SemanticMatcher } from './embeddings';
import type { MatchScore, ParsedJob, ParsedResume } from './models';

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

    // Mock extraction
    const skills = ['javascript', 'typescript', 'react', 'node.js', 'sql'].filter((s) =>
      lowerText.includes(s),
    );
    const technologies = ['aws', 'docker', 'kubernetes', 'git'].filter((s) =>
      lowerText.includes(s),
    );

    // Mock experience parsing
    const experience = [];
    if (lowerText.includes('senior')) {
      experience.push({ role: 'Senior Developer', years: 5 });
    } else {
      experience.push({ role: 'Developer', years: 2 });
    }

    return {
      skills,
      technologies,
      experience,
      education: ['B.S. Computer Science'],
      keywords: [...skills, ...technologies],
    };
  }

  /**
   * Parses the raw job description text.
   */
  public async parseJobDescription(text: string): Promise<ParsedJob> {
    const lowerText = text.toLowerCase();

    const skills = ['javascript', 'typescript', 'react', 'python', 'graphql'].filter((s) =>
      lowerText.includes(s),
    );
    const technologies = ['aws', 'docker', 'ci/cd'].filter((s) => lowerText.includes(s));

    const minExperience = lowerText.includes('senior') ? 5 : 2;

    return {
      requirements: ['Develop features', 'Write tests'],
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
}

export const resumeMatcherService = new ResumeMatcherService();
