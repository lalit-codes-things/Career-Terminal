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
  experience: Array<{ role: string | null; company: string | null; dates: string | null; years: number; raw: string }>;
  education: Array<{ degree: string | null; field: string | null; institution: string | null; year: string | null; raw: string }>;
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
