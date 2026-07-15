import {
  JobEmailClassifier,
  JobEmailCategory,
  ruleBasedJobEmailClassifier,
  type ClassifiableEmail,
  type JobEmailMlModel,
} from '../services/job-intelligence';

function makeEmail(overrides: Partial<ClassifiableEmail> = {}): ClassifiableEmail {
  return {
    emailId: 'email-1',
    sender: 'noreply@example.com',
    subject: 'Hello',
    bodyText: 'Generic message body.',
    ...overrides,
  };
}

describe('RuleBasedJobEmailClassifier', () => {
  it('classifies job application confirmations from ATS senders', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'noreply@greenhouse.io',
        subject: 'Application received — Software Engineer',
        bodyText: 'Thank you for applying. We received your application.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.JOB_APPLICATION);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.matchedSignals.some((s: string) => s.startsWith('keyword:'))).toBe(true);
  });

  it('classifies interview invitations', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'recruiting@stripe.com',
        subject: 'Interview scheduled for Senior Backend Engineer',
        bodyText: 'We would like to invite you to interview for the next round.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.INTERVIEW_INVITATION);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies rejections', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'talent@acme.com',
        subject: 'Update on your application',
        bodyText:
          'Unfortunately, we have decided to pursue other candidates and will not be moving forward.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.REJECTION);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies offer letters', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'hr@company.com',
        subject: 'Offer letter — Product Manager',
        bodyText: 'We are pleased to offer you the position with a compensation package.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.OFFER);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies recruiter outreach', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'recruiter@agency.com',
        subject: 'Exciting opportunity at Fintech Co',
        bodyText:
          'I am a recruiter reaching out regarding an open role that could be a great fit for you.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.RECRUITER_OUTREACH);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies assessment and test invitations', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'notifications@hackerrank.com',
        subject: 'Complete your coding challenge',
        bodyText: 'Please complete the assessment within 48 hours.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.ASSESSMENT_TEST);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies networking emails', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'alex@startup.io',
        subject: 'Coffee chat?',
        bodyText: 'Would love to connect on LinkedIn and schedule a networking chat.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.NETWORKING);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies career newsletters', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'jobs@newsletter.com',
        subject: 'Weekly digest: top jobs for you',
        bodyText: 'Career tips and job alerts. Click unsubscribe to opt out.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.CAREER_NEWSLETTER);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('returns Not Job Related for unrelated personal email', () => {
    const result = ruleBasedJobEmailClassifier.classify(
      makeEmail({
        sender: 'friend@gmail.com',
        subject: 'Weekend plans',
        bodyText: 'Want to grab dinner on Saturday?',
      })
    );

    expect(result.category).toBe(JobEmailCategory.NOT_JOB_RELATED);
  });
});

describe('JobEmailClassifier entity extraction', () => {
  const classifier = new JobEmailClassifier();

  it('extracts company from sender domain', () => {
    const result = classifier.classify(
      makeEmail({
        sender: 'recruiting@stripe.com',
        subject: 'Interview scheduled',
        bodyText: 'We invite you to interview for the next round.',
      })
    );

    expect(result.detectedCompany).toBe('Stripe');
    expect(result.emailId).toBe('email-1');
  });

  it('extracts role from subject line', () => {
    const result = classifier.classify(
      makeEmail({
        sender: 'noreply@greenhouse.io',
        subject: 'Application received for Senior Backend Engineer',
        bodyText: 'Thank you for applying. We received your application.',
      })
    );

    expect(result.detectedRole).toBe('Senior Backend Engineer');
  });

  it('uses HTML body when plain text is missing', () => {
    const result = classifier.classify(
      makeEmail({
        bodyText: null,
        bodyHtml: '<p>Your <strong>application received</strong> confirmation.</p>',
        sender: 'noreply@lever.co',
        subject: 'Application update',
      })
    );

    expect(result.category).toBe(JobEmailCategory.JOB_APPLICATION);
  });
});

describe('JobEmailClassifier ML fallback', () => {
  it('uses rules when confidence is above threshold', async () => {
    const mlModel: JobEmailMlModel = {
      classify: jest.fn().mockResolvedValue({
        emailId: 'email-1',
        category: JobEmailCategory.NOT_JOB_RELATED,
        confidence: 0.99,
        detectedCompany: null,
        detectedRole: null,
      }),
    };

    const classifier = new JobEmailClassifier({
      mlModel,
      mlConfidenceThreshold: 0.65,
    });

    const result = await classifier.classifyAsync(
      makeEmail({
        sender: 'noreply@greenhouse.io',
        subject: 'Offer letter',
        bodyText: 'We are pleased to offer you the job offer and compensation package.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.OFFER);
    expect(mlModel.classify).not.toHaveBeenCalled();
  });

  it('falls back to ML when rule confidence is low', async () => {
    const mlModel: JobEmailMlModel = {
      classify: jest.fn().mockResolvedValue({
        emailId: 'email-1',
        category: JobEmailCategory.RECRUITER_OUTREACH,
        confidence: 0.91,
        detectedCompany: 'Anthropic',
        detectedRole: 'Research Engineer',
      }),
    };

    const classifier = new JobEmailClassifier({
      mlModel,
      mlConfidenceThreshold: 0.95,
    });

    const result = await classifier.classifyAsync(
      makeEmail({
        sender: 'friend@gmail.com',
        subject: 'Quick question',
        bodyText: 'Can you review my resume draft?',
      })
    );

    expect(mlModel.classify).toHaveBeenCalled();
    expect(result.category).toBe(JobEmailCategory.RECRUITER_OUTREACH);
    expect(result.detectedCompany).toBe('Anthropic');
  });

  it('keeps rule result when ML returns lower confidence', async () => {
    const mlModel: JobEmailMlModel = {
      classify: jest.fn().mockResolvedValue({
        emailId: 'email-1',
        category: JobEmailCategory.NOT_JOB_RELATED,
        confidence: 0.4,
        detectedCompany: null,
        detectedRole: null,
      }),
    };

    const classifier = new JobEmailClassifier({
      mlModel,
      mlConfidenceThreshold: 0.99,
    });

    const result = await classifier.classifyAsync(
      makeEmail({
        sender: 'noreply@workday.com',
        subject: 'Rejected',
        bodyText: 'Unfortunately we are not moving forward with your application.',
      })
    );

    expect(result.category).toBe(JobEmailCategory.REJECTION);
  });
});

describe('job-intelligence barrel export', () => {
  it('exports classifier from index', () => {
    expect(JobEmailCategory.OFFER).toBe('Offer');
  });
});
