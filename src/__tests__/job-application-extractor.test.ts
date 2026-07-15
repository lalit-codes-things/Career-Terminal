import { JobApplicationExtractor, JobApplicationStatus } from '../services/job-intelligence';
import { JobEmailCategory, type ClassifiableEmail } from '../services/job-intelligence/models/job-intelligence.types';

function makeEmail(overrides: Partial<ClassifiableEmail> = {}): ClassifiableEmail {
  return {
    emailId: 'email-1',
    sender: 'recruiting@stripe.com',
    subject: 'Application received for Senior Backend Engineer',
    bodyText: 'Hi Maya Chen, thanks for applying to Stripe. We are reviewing your application for the Engineering team in New York. Please complete your assessment by March 15, 2026.',
    ...overrides,
  };
}

describe('JobApplicationExtractor', () => {
  it('extracts structured application fields from a job-related email', () => {
    const extractor = new JobApplicationExtractor();

    const application = extractor.extract(
      makeEmail(),
      'user-1',
      {
        emailId: 'email-1',
        category: JobEmailCategory.JOB_APPLICATION,
        confidence: 0.95,
        detectedCompany: 'Stripe',
        detectedRole: 'Senior Backend Engineer',
      },
    );

    expect(application.company.name).toBe('Stripe');
    expect(application.company.domain).toBe('stripe.com');
    expect(application.role.title).toBe('Senior Backend Engineer');
    expect(application.role.department).toBe('Engineering');
    expect(application.status).toBe(JobApplicationStatus.APPLIED);
    expect(application.appliedDate).toBeInstanceOf(Date);
    expect(application.recruiter.name).toBe('Maya Chen');
    expect(application.recruiter.email).toBe('maya@stripe.com');
    expect(application.sourceEmailId).toBe('email-1');
  });

  it('detects interview stage and round count from interview emails', () => {
    const extractor = new JobApplicationExtractor();

    const application = extractor.extract(
      makeEmail({
        subject: 'Interview round 2 scheduled',
        bodyText: 'We would like to invite you to your second round interview next week in Seattle.',
        sender: 'maya@stripe.com',
      }),
      'user-2',
      {
        emailId: 'email-2',
        category: JobEmailCategory.INTERVIEW_INVITATION,
        confidence: 0.94,
        detectedCompany: 'Stripe',
        detectedRole: 'Product Manager',
      },
    );

    expect(application.status).toBe(JobApplicationStatus.INTERVIEW);
    expect(application.hiringProcess.currentStage).toBe('Interview');
    expect(application.hiringProcess.interviewRounds).toBe(2);
    expect(application.details.location).toBe('Seattle');
  });
});
