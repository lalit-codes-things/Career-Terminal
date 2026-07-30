export interface MatchScore {
  overallScore: number;
  skillMatch: number;
  occupationMatch: number;
  experienceMatch: number;
  missingSkills: string[];
  improvementSuggestions: string[];
}

export interface ParsedResume {
  skills: string[];
  technologies: string[];
  occupations: string[];
  experience: Array<{ role: string; years: number }>;
  education: string[];
  keywords: string[];
}

export interface ParsedJob {
  requirements: string[];
  skills: string[];
  technologies: string[];
  occupations: string[];
  minExperience: number;
  keywords: string[];
}
