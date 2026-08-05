/**
 * resume-lexicon.ts
 *
 * All skill and occupation terms now come exclusively from AiTaxonomyService.
 

import { aiTaxonomyService } from '../services/career-taxonomy/ai-taxonomy.service';

export async function getResumeSkillLexicon(text?: string): Promise<string[]> {
  return text ? aiTaxonomyService.getSkillTerms(text).catch(() => []) : [];
}

export async function getResumeTechLexicon(text?: string): Promise<string[]> {
  return getResumeSkillLexicon(text);
}

export async function getJobSkillLexicon(text?: string): Promise<string[]> {
  return getResumeSkillLexicon(text);
}

export async function getJobTechLexicon(text?: string): Promise<string[]> {
  return getResumeSkillLexicon(text);
}

export async function getResumeOccupationLexicon(text?: string): Promise<string[]> {
  return text ? aiTaxonomyService.getOccupationTerms(text).catch(() => []) : [];
}

export async function getJobOccupationLexicon(text?: string): Promise<string[]> {
  return getResumeOccupationLexicon(text);
}
