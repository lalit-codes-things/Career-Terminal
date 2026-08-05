import { JobEmailClassifier, JobEmailCategory, type ClassifiableEmail } from '../services/job-intelligence';
import { pipeline } from '../services/recruiter-intelligence/ai/pipeline.factory';
import type { ExtractionOutput, ExtractedField } from '../services/recruiter-intelligence/ai/types';

jest.mock('../services/recruiter-intelligence/ai/pipeline.factory');

function mockProvenance() {
  return {
    source: 'ai-extraction:email:email-1',
    sourceId: 'email-1',
    collector: 'stub/stub-model',
    collectedAt: '2026-08-05T12:00:00.000Z',
    consentState: 'granted' as const,
  };
}

function makeField(field: string, value: unknown, rawValue: string, confidence: number): ExtractedField {
  return {
    field,
    value,
    rawValue,
    confidence,
    confidenceBand: confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
    evidence: [{ sourceId: 'email-1', excerpt: rawValue, confidence }],
    provenance: mockProvenance(),
  };
}

function makeMockOutput(fields: ExtractedField[], overallConfidence: number): ExtractionOutput {
  return {
    extractionId: 'test-extraction',
    templateId: 'job-email-classification',
    templateVersion: '1.0.0',
    provider: 'stub',
    model: 'stub-model',
    fields,
    overallConfidence,
    confidenceBand: overallConfidence >= 0.8 ? 'high' : overallConfidence >= 0.5 ? 'medium' : 'low',
    evidence: [],
    provenance: mockProvenance(),
      usage: {
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.001,
      provider: 'stub',
      model: 'stub-model',
      templateId: 'job-email-classification',
      tenantId: 'default',
      latencyMs: 50,
      success: true,
      totalTokens: 150,
    },
    completedAt: new Date(),
    requiresHumanReview: overallConfidence < 0.55,
  };
}

function makeEmail(overrides: Partial<ClassifiableEmail> = {}): ClassifiableEmail {
  return {
    emailId: 'email-1',
    sender: 'noreply@example.com',
    subject: 'Hello',
    bodyText: 'Generic message body.',
    ...overrides,
  };
}

describe('JobEmailClassifier (AI-based)', () => {
  const classifier = new JobEmailClassifier();
  const mockExtract = jest.mocked(pipeline.extract);

  beforeEach(() => {
    mockExtract.mockClear();
    mockExtract.mockResolvedValue(
      makeMockOutput(
        [
          makeField('category', 'Job Application', 'Application received', 0.89),
          makeField('company', 'Stripe', 'Stripe', 0.85),
          makeField('role', 'Software Engineer', 'Senior Backend Engineer', 0.92),
        ],
        0.89,
      ),
    );
  });

  it('calls pipeline.extract with job-email-classification template', async () => {
    await classifier.classify(makeEmail());

    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockExtract).toHaveBeenCalledWith(
      'job-email-classification',
      expect.objectContaining({ sourceType: 'email', sourceId: 'email-1' }),
      expect.objectContaining({ emailId: 'email-1', sender: 'noreply@example.com' }),
    );
  });

  it('maps AI output category to JobEmailCategory enum', async () => {
    const result = await classifier.classify(makeEmail());
    expect(result.category).toBe(JobEmailCategory.JOB_APPLICATION);
  });

  it('extracts company and role from AI fields', async () => {
    const result = await classifier.classify(makeEmail());
    expect(result.detectedCompany).toBe('Stripe');
    expect(result.detectedRole).toBe('Software Engineer');
  });

  it('passes through overall confidence', async () => {
    const result = await classifier.classify(makeEmail());
    expect(result.confidence).toBe(0.89);
  });

  it('handles null company/role values', async () => {
    mockExtract.mockResolvedValueOnce(
      makeMockOutput([makeField('category', 'Not Job Related', '', 0.95)], 0.95),
    );

    const result = await classifier.classify(makeEmail());
    expect(result.detectedCompany).toBeNull();
    expect(result.detectedRole).toBeNull();
    expect(result.category).toBe(JobEmailCategory.NOT_JOB_RELATED);
  });

  it('normalizes unknown categories to Not Job Related', async () => {
    mockExtract.mockResolvedValueOnce(
      makeMockOutput([makeField('category', 'Unknown Category', '???', 0.3)], 0.3),
    );

    const result = await classifier.classify(makeEmail());
    expect(result.category).toBe(JobEmailCategory.NOT_JOB_RELATED);
  });

  it('falls back to HTML body when plain text is missing', async () => {
    await classifier.classify(makeEmail({ bodyText: null, bodyHtml: '<p>Application received</p>' }));
    const call = mockExtract.mock.calls[0];
    expect(call).toBeTruthy();
    expect(call![2]['content']).toBe('<p>Application received</p>');
  });

  it('uses empty string when both body types are missing', async () => {
    await classifier.classify(makeEmail({ bodyText: null, bodyHtml: null }));
    const call = mockExtract.mock.calls[0];
    expect(call![2]['content']).toBe('');
  });
});
