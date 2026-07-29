import { applicationMergeService } from '../services/application-merge/application-merge.service';
import { prisma } from '../config/database';
import type { ExtractedJobData } from '../services/application-tracking/application-tracking.service';
import type { ClassifiableEmail } from '../services/job-intelligence';
import type { JobApplication } from '@prisma/client';

jest.mock('../config/database', () => ({
  prisma: {
    jobApplication: {
      findMany: jest.fn(),
    },
  },
}));

describe('ApplicationMergeService', () => {
  const userId = 'user-1';

  const mockIncomingData: ExtractedJobData = {
    userId,
    company: { name: 'Acme Corp', domain: 'acme.com' },
    role: { title: 'Software Engineer' },
    status: 'APPLIED',
    appliedDate: new Date('2026-07-15'),
    recruiter: { email: 'recruiter@acme.com' },
    details: {},
    hiringProcess: { deadlines: [] },
  };

  const mockSourceEmail: ClassifiableEmail = {
    emailId: 'email-1',
    subject: 'Your application to Acme Corp',
    sender: 'recruiter@acme.com',
    threadId: 'thread-1',
  };

  const createMockApp = (overrides: Partial<JobApplication>): JobApplication => ({
    id: 'app-1',
    userId,
    legacyUserId: userId,
    companyName: 'Acme Corp',
    companyDomain: 'acme.com',
    roleTitle: 'Software Engineer',
    roleDepartment: 'Engineering',
    status: 'APPLIED',
    appliedDate: new Date('2026-07-10'),
    recruiterId: null,
    companyId: null,
    opportunityId: null,
    recruiterName: 'Alice',
    recruiterEmail: 'recruiter@acme.com',
    sourceEmailId: 'email-0',
    location: 'Remote',
    employmentType: 'Full-time',
    currentStage: 'Applied',
    interviewRounds: 0,
    deadlines: [],
    candidateEmail: 'candidate@example.com',
    atsApplicationId: 'ats-123',
    threadIds: ['thread-1'],
    snapshotId: null,
    sourceProvider: 'MANUAL',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
    appliedAt: null,
    ...overrides,
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should strictly reject if companies are different', async () => {
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([
      createMockApp({ companyDomain: 'other.com', companyName: 'Other Corp' }),
    ]);

    const result = await applicationMergeService.findMatch(
      userId,
      mockIncomingData,
      mockSourceEmail,
    );
    expect(result.confidenceScore).toBe(0);
    expect(result.targetApplication).toBeNull();
    expect(result.reasons).toContain('Strict Reject: Different companies');
  });

  it('should merge identical role, same thread, same recruiter', async () => {
    const existingApp = createMockApp({});
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([existingApp]);

    const result = await applicationMergeService.findMatch(
      userId,
      mockIncomingData,
      mockSourceEmail,
      'candidate@example.com',
    );

    // Exact role (+50), Candidate email (+20), Thread ID (+30), Recruiter (+20), Date (+15)
    expect(result.confidenceScore).toBe(100); // capped at 100
    expect(result.targetApplication?.id).toBe(existingApp.id);
  });

  it('should strictly reject same company but wildly different role without ATS id', async () => {
    const existingApp = createMockApp({ roleTitle: 'Marketing Manager' });
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([existingApp]);

    const result = await applicationMergeService.findMatch(
      userId,
      mockIncomingData,
      mockSourceEmail,
    );

    expect(result.confidenceScore).toBe(0);
    expect(result.targetApplication).toBeNull();
    expect(result.reasons).toContain('Strict Reject: Different roles without ATS ID override');
  });

  it('should merge same company, different role IF exact ATS ID matches', async () => {
    const existingApp = createMockApp({
      roleTitle: 'Marketing Manager',
      atsApplicationId: 'ats-999',
    });
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([existingApp]);

    const result = await applicationMergeService.findMatch(
      userId,
      mockIncomingData,
      mockSourceEmail,
      undefined,
      'ats-999',
    );

    // ATS ID match (+100)
    expect(result.confidenceScore).toBe(100);
    expect(result.targetApplication?.id).toBe(existingApp.id);
  });

  it('should create new (not merge) for low confidence match', async () => {
    // Same company, fuzzy role match but no thread, different recruiter, long time ago
    const existingApp = createMockApp({
      roleTitle: 'Senior Software Engineer', // fuzzy role (+30)
      threadIds: [],
      recruiterEmail: 'someone-else@acme.com',
      appliedDate: new Date('2025-01-01'), // not close date
    });

    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([existingApp]);

    const result = await applicationMergeService.findMatch(
      userId,
      mockIncomingData,
      mockSourceEmail,
    );

    // Confidence = fuzzy role (30). Total = 30 < 80.
    expect(result.confidenceScore).toBe(30);
    expect(result.targetApplication).toBeNull(); // Do not merge
  });

  it('should merge immediately when incoming opportunity_id matches existing (strongest signal)', async () => {
    // Company + role are deliberately different so that text-based matching would fail
    const existingApp = createMockApp({
      companyName: 'Totally Different Company',
      companyDomain: 'other.com',
      roleTitle: 'Marketing Director',
      opportunityId: 'opp-canonical-abc-123',
    });

    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([existingApp]);

    const result = await applicationMergeService.findMatch(
      userId,
      mockIncomingData,
      mockSourceEmail,
      undefined,
      undefined,
      'opp-canonical-abc-123',
    );

    expect(result.confidenceScore).toBe(100);
    expect(result.targetApplication?.id).toBe(existingApp.id);
    expect(result.reasons[0]).toBe('+100: Exact canonical opportunity_id match');
  });
});
