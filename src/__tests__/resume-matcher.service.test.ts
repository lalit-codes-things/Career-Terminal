import { ResumeMatcherService } from '../services/resume-matcher/resume-matcher.service';
import { pipeline } from '../services/recruiter-intelligence/ai/pipeline.factory';
import type { ExtractionOutput, ExtractedField } from '../services/recruiter-intelligence/ai/types';

jest.mock('../services/recruiter-intelligence/ai/pipeline.factory');

function mockProvenance() {
  return {
    source: 'ai-extraction:document:doc-1',
    sourceId: 'doc-1',
    collector: 'openrouter/deepseek/deepseek-chat',
    collectedAt: '2026-08-05T12:00:00.000Z',
    consentState: 'granted' as const,
  };
}

function makeField(
  field: string,
  value: unknown,
  rawValue: string,
  confidence: number,
): ExtractedField {
  return {
    field,
    value,
    rawValue,
    confidence,
    confidenceBand: confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
    evidence: [{ sourceId: 'doc-1', excerpt: rawValue, confidence }],
    provenance: mockProvenance(),
  };
}

function makeMockOutput(fields: ExtractedField[], overallConfidence = 0.85): ExtractionOutput {
  return {
    extractionId: 'test-extraction',
    templateId: 'resume-extraction',
    templateVersion: '1.0.0',
    provider: 'stub',
    model: 'stub-model',
    fields,
    overallConfidence,
    confidenceBand: 'high',
    evidence: [],
    provenance: mockProvenance(),
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.001,
      provider: 'stub',
      model: 'stub-model',
      templateId: 'resume-extraction',
      tenantId: 'default',
      latencyMs: 50,
      success: true,
      totalTokens: 150,
    },
    completedAt: new Date(),
    requiresHumanReview: false,
  };
}

describe('ResumeMatcherService (AI-based)', () => {
  let service: ResumeMatcherService;
  const mockExtract = jest.mocked(pipeline.extract);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResumeMatcherService();
  });

  describe('parseResume', () => {
    it('extracts skills from AI pipeline output', async () => {
      mockExtract.mockResolvedValue(
        makeMockOutput([
          makeField('skill', 'Python', 'Python', 0.88),
          makeField('skill', 'Project Management', 'Project Management', 0.85),
          makeField('technology', 'React', 'React', 0.82),
          makeField('occupation', 'Software Engineer', 'Software Engineer', 0.8),
        ]),
      );

      const parsed = await service.parseResume('Sample resume text');

      expect(parsed.skills).toContain('Python');
      expect(parsed.skills).toContain('Project Management');
      expect(parsed.technologies).toContain('React');
      expect(parsed.occupations).toContain('Software Engineer');
    });

    it('extracts experience entries with parsed fields', async () => {
      mockExtract.mockResolvedValue(
        makeMockOutput([
          makeField(
            'experience',
            { role: 'example-role', company: 'example-organization', dates: '2020-Present', years: 4 },
            'example-role at example-organization (2020-Present)',
            0.82,
          ),
        ]),
      );

      const parsed = await service.parseResume('Sample resume text');

      expect(parsed.experience).toHaveLength(1);
      expect(parsed.experience[0]?.company).toBe('example-organization');
      expect(parsed.experience[0]?.raw).toContain('example-organization');
    });

    it('extracts education entries with parsed fields', async () => {
      mockExtract.mockResolvedValue(
        makeMockOutput([
          makeField(
            'education',
            { degree: 'example-degree', field: 'example-field', institution: 'example-institution', year: '2016' },
            'example-degree example-field, example-institution, 2016',
            0.8,
          ),
        ]),
      );

      const parsed = await service.parseResume('Sample resume text');

      expect(parsed.education).toHaveLength(1);
      expect(parsed.education[0]?.institution).toBe('example-institution');
    });

    it('returns empty arrays when pipeline returns no fields', async () => {
      mockExtract.mockResolvedValue(makeMockOutput([], 0));

      const parsed = await service.parseResume('No relevant content');

      expect(parsed.skills).toHaveLength(0);
      expect(parsed.experience).toHaveLength(0);
      expect(parsed.education).toHaveLength(0);
    });

    it('builds keywords from skills, technologies, and occupations combined', async () => {
      mockExtract.mockResolvedValue(
        makeMockOutput([
          makeField('skill', 'Python', 'Python', 0.85),
          makeField('technology', 'Docker', 'Docker', 0.85),
          makeField('occupation', 'Data Scientist', 'Data Scientist', 0.8),
        ]),
      );

      const parsed = await service.parseResume('Sample resume');

      expect(parsed.keywords).toContain('Python');
      expect(parsed.keywords).toContain('Docker');
      expect(parsed.keywords).toContain('Data Scientist');
    });
  });

  describe('parseJobDescription', () => {
    it('extracts skills and min experience from AI pipeline output', async () => {
      mockExtract.mockResolvedValue(
        makeMockOutput([
          makeField('skill', 'Python', 'Python', 0.88),
          makeField('skill', 'Machine Learning', 'Machine Learning', 0.85),
          makeField('min_experience', 3, '3+ years required', 0.7),
        ]),
      );

      const parsed = await service.parseJobDescription('Seeking engineer with Python and ML');

      expect(parsed.skills).toContain('Python');
      expect(parsed.skills).toContain('Machine Learning');
      expect(parsed.minExperience).toBe(3);
    });

    it('defaults minExperience to 0 when not found', async () => {
      mockExtract.mockResolvedValue(
        makeMockOutput([makeField('skill', 'Python', 'Python', 0.85)]),
      );

      const parsed = await service.parseJobDescription('Generic role');

      expect(parsed.minExperience).toBe(0);
    });
  });

  describe('scoreMatch', () => {
    it('calculates score > 0.5 when resume and job share skills', async () => {
      const resumeFields = [
        makeField('skill', 'Python', 'Python', 0.88),
        makeField('skill', 'Project Management', 'Project Management', 0.85),
      ];
      const jobFields = [
        makeField('skill', 'Python', 'Python', 0.88),
        makeField('skill', 'Project Management', 'Project Management', 0.85),
      ];

      mockExtract
        .mockResolvedValueOnce(makeMockOutput(resumeFields))
        .mockResolvedValueOnce(makeMockOutput(jobFields));

      const score = await service.scoreMatch('resume text', 'job text');

      expect(score.overallScore).toBeGreaterThan(0.5);
      expect(score.skillMatch).toBeGreaterThan(0.5);
    });

    it('identifies missing skills in the job but not resume', async () => {
      mockExtract
        .mockResolvedValueOnce(
          makeMockOutput([makeField('skill', 'Python', 'Python', 0.88)]),
        )
        .mockResolvedValueOnce(
          makeMockOutput([
            makeField('skill', 'Python', 'Python', 0.88),
            makeField('skill', 'Machine Learning', 'Machine Learning', 0.85),
          ]),
        );

      const score = await service.scoreMatch('resume with Python', 'job needs Python and ML');

      expect(score.missingSkills).toContain('Machine Learning');
    });

    it('returns experienceMatch = 1.0 when job has no experience requirement', async () => {
      mockExtract
        .mockResolvedValueOnce(makeMockOutput([]))
        .mockResolvedValueOnce(makeMockOutput([]));

      const score = await service.scoreMatch('general text', 'general role');

      expect(score.experienceMatch).toBe(1.0);
    });
  });

  describe('callPipeline', () => {
    it('calls pipeline.extract with resume-extraction template', async () => {
      mockExtract.mockResolvedValue(
        makeMockOutput([makeField('skill', 'Python', 'Python', 0.88)]),
      );

      await service.parseResume('resume text');

      expect(mockExtract).toHaveBeenCalledTimes(1);
      expect(mockExtract).toHaveBeenCalledWith(
        'resume-extraction',
        expect.objectContaining({ sourceType: 'document' }),
        expect.objectContaining({ content: 'resume text' }),
      );
    });
  });
});
