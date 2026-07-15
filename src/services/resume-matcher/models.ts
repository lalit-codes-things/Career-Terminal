export interface MatchScore {
  overallScore: number;
  skillMatch: number;
  experienceMatch: number;
  missingSkills: string[];
  improvementSuggestions: string[];
}

export interface ParsedResume {
  skills: string[];
  technologies: string[];
  experience: Array<{ role: string; years: number }>;
  education: string[];
  keywords: string[];
}

export interface ParsedJob {
  requirements: string[];
  skills: string[];
  technologies: string[];
  minExperience: number;
  keywords: string[];
}
