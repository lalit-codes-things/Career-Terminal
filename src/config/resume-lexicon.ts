import { careerTaxonomyService } from '../services/career-taxonomy/career-taxonomy.service';

export async function getResumeSkillLexicon(): Promise<string[]> {
  return careerTaxonomyService.getSkillTerms();
}

export async function getResumeTechLexicon(): Promise<string[]> {
  return careerTaxonomyService.getSkillTerms();
}

export async function getJobSkillLexicon(): Promise<string[]> {
  return careerTaxonomyService.getSkillTerms();
}

export async function getJobTechLexicon(): Promise<string[]> {
  return careerTaxonomyService.getSkillTerms();
}

export async function getResumeOccupationLexicon(): Promise<string[]> {
  return careerTaxonomyService.getOccupationTerms();
}

export async function getJobOccupationLexicon(): Promise<string[]> {
  return careerTaxonomyService.getOccupationTerms();
}
