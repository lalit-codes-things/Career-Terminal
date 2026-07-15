import { ResumeMatcherService } from '../services/resume-matcher/resume-matcher.service';

describe('ResumeMatcherService', () => {
  let service: ResumeMatcherService;

  beforeEach(() => {
    service = new ResumeMatcherService();
  });

  it('should parse resume text correctly', async () => {
    const resumeText = 'I am a senior developer with experience in React, JavaScript, and Node.js. I know AWS and Docker too. B.S. Computer Science.';
    const parsed = await service.parseResume(resumeText);
    
    expect(parsed.skills).toEqual(expect.arrayContaining(['react', 'javascript', 'node.js']));
    expect(parsed.technologies).toEqual(expect.arrayContaining(['aws', 'docker']));
    expect(parsed.experience[0]?.role).toBe('Senior Developer');
    expect(parsed.experience[0]?.years).toBe(5);
  });

  it('should calculate match score correctly', async () => {
    const resumeText = 'I am a senior developer with experience in React, JavaScript, and Node.js. I know AWS and Docker too.';
    const jobText = 'Looking for a senior developer who knows JavaScript, TypeScript, React, AWS, Docker, CI/CD.';
    
    const score = await service.scoreMatch(resumeText, jobText);
    
    expect(score.overallScore).toBeGreaterThan(0.5);
    expect(score.skillMatch).toBeGreaterThan(0.5);
    expect(score.experienceMatch).toBe(1.0); // Resume says 'senior' (5 years), job asks for 'senior' (5 years)
    
    expect(score.missingSkills).toContain('typescript');
    expect(score.missingSkills).toContain('ci/cd');
    expect(score.improvementSuggestions.length).toBeGreaterThan(0);
  });

  it('should penalize missing experience', async () => {
    const resumeText = 'I am a developer with experience in React, JavaScript.';
    const jobText = 'Looking for a senior developer who knows JavaScript, React, AWS.';
    
    const score = await service.scoreMatch(resumeText, jobText);
    
    expect(score.experienceMatch).toBe(2 / 5); // developer (2) vs senior (5)
    expect(score.improvementSuggestions).toContain('Highlight more relevant experience to meet the 5 year requirement.');
  });
});
