import { prisma } from '../config/database';
import { statusEngine } from '../services/status-engine';
import { JobEmailCategory } from '../services/job-intelligence';
import { JobApplicationStatus } from '../services/job-application';
import { DEFAULT_PAGE_SIZE } from '../domain/pagination';

jest.mock('../config/database', () => {
  const prisma = {
    jobApplication: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    applicationStatusHistory: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    applicationTimeline: {
      create: jest.fn(),
    },
  };
  return {
    prisma,
  dbRouter: {
    read: jest.fn().mockReturnValue(prisma),
    write: jest.fn().mockReturnValue(prisma),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },
  };
});

const mockPrisma = prisma as unknown as {
  jobApplication: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  applicationStatusHistory: {
    findMany: jest.Mock;
    create: jest.Mock;
  };
  applicationTimeline: {
    create: jest.Mock;
  };
};

describe('StatusEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not regress status when a late older email arrives', async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      status: JobApplicationStatus.OFFER,
      currentStage: 'Offer',
    });
    mockPrisma.applicationStatusHistory.findMany
      .mockResolvedValueOnce([
        {
          id: 'hist-1',
          applicationId: 'app-1',
          previousStatus: JobApplicationStatus.ASSESSMENT,
          status: JobApplicationStatus.OFFER,
          source: 'EMAIL',
          sourceEmailId: 'email-late',
          changedByUserId: null,
          timestamp: new Date('2026-07-10T00:00:00.000Z'),
          metadata: null,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          updatedAt: new Date('2026-07-10T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'hist-2',
          applicationId: 'app-1',
          previousStatus: JobApplicationStatus.OFFER,
          status: JobApplicationStatus.ASSESSMENT,
          source: 'EMAIL',
          sourceEmailId: 'email-old',
          changedByUserId: null,
          timestamp: new Date('2026-07-05T00:00:00.000Z'),
          metadata: null,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
          updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        },
        {
          id: 'hist-1',
          applicationId: 'app-1',
          previousStatus: JobApplicationStatus.ASSESSMENT,
          status: JobApplicationStatus.OFFER,
          source: 'EMAIL',
          sourceEmailId: 'email-late',
          changedByUserId: null,
          timestamp: new Date('2026-07-10T00:00:00.000Z'),
          metadata: null,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          updatedAt: new Date('2026-07-10T00:00:00.000Z'),
        },
      ]);
    mockPrisma.applicationStatusHistory.create.mockResolvedValue({
      id: 'hist-2',
      applicationId: 'app-1',
      previousStatus: JobApplicationStatus.OFFER,
      status: JobApplicationStatus.ASSESSMENT,
      source: 'EMAIL',
      sourceEmailId: 'email-old',
      changedByUserId: null,
      timestamp: new Date('2026-07-05T00:00:00.000Z'),
      metadata: null,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    });

    const result = await statusEngine.applyEmailStatus(
      'app-1',
      {
        emailId: 'email-old',
        category: JobEmailCategory.ASSESSMENT_TEST,
        confidence: 0.95,
        detectedCompany: 'example-organization',
        detectedRole: 'Engineer',
      },
      {
        emailId: 'email-old',
        receivedAt: new Date('2026-07-05T00:00:00.000Z'),
        subject: 'Assessment reminder',
      },
      prisma,
    );

    expect(result?.application.status).toBe(JobApplicationStatus.OFFER);
    expect(result?.timelineEvent).toBeNull();
    expect(mockPrisma.jobApplication.update).not.toHaveBeenCalled();
  });

  it('records manual overrides in history and updates the application', async () => {
    mockPrisma.jobApplication.findUnique.mockResolvedValue({
      id: 'app-2',
      status: JobApplicationStatus.APPLIED,
      currentStage: 'Applied',
    });
    mockPrisma.applicationStatusHistory.findMany
      .mockResolvedValueOnce([
        {
          id: 'hist-1',
          applicationId: 'app-2',
          previousStatus: null,
          status: JobApplicationStatus.APPLIED,
          source: 'EMAIL',
          sourceEmailId: 'email-1',
          changedByUserId: null,
          timestamp: new Date('2026-07-01T00:00:00.000Z'),
          metadata: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'hist-1',
          applicationId: 'app-2',
          previousStatus: null,
          status: JobApplicationStatus.APPLIED,
          source: 'EMAIL',
          sourceEmailId: 'email-1',
          changedByUserId: null,
          timestamp: new Date('2026-07-01T00:00:00.000Z'),
          metadata: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'hist-2',
          applicationId: 'app-2',
          previousStatus: JobApplicationStatus.APPLIED,
          status: JobApplicationStatus.REJECTED,
          source: 'MANUAL',
          sourceEmailId: null,
          changedByUserId: 'user-1',
          timestamp: new Date('2026-07-15T00:00:00.000Z'),
          metadata: null,
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
          updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        },
      ]);
    mockPrisma.applicationStatusHistory.create.mockResolvedValue({
      id: 'hist-2',
      applicationId: 'app-2',
      previousStatus: JobApplicationStatus.APPLIED,
      status: JobApplicationStatus.REJECTED,
      source: 'MANUAL',
      sourceEmailId: null,
      changedByUserId: 'user-1',
      timestamp: new Date('2026-07-15T00:00:00.000Z'),
      metadata: null,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    });
    mockPrisma.applicationTimeline.create.mockResolvedValue({
      id: 'evt-1',
      applicationId: 'app-2',
      eventType: 'REJECTION',
      timestamp: new Date('2026-07-15T00:00:00.000Z'),
      sourceEmailId: null,
      metadata: null,
      description: 'Application status updated to REJECTED',
    });
    mockPrisma.jobApplication.update.mockResolvedValue({
      id: 'app-2',
      status: JobApplicationStatus.REJECTED,
      currentStage: 'Rejected',
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    });

    const result = await statusEngine.overrideStatus(
      'app-2',
      JobApplicationStatus.REJECTED,
      'user-1',
      prisma,
    );

    expect(result.application.status).toBe(JobApplicationStatus.REJECTED);
    expect(result.timelineEvent?.eventType).toBe('REJECTION');
    expect(mockPrisma.jobApplication.update).toHaveBeenCalledWith({
      where: { id: 'app-2' },
      data: {
        status: JobApplicationStatus.REJECTED,
        currentStage: 'Rejected',
      },
    });
  });

  it('applies default pagination when no pagination args are passed to getStatusHistory', async () => {
    mockPrisma.jobApplication.findFirst.mockResolvedValue({
      id: 'app-1',
      status: JobApplicationStatus.APPLIED,
      currentStage: 'Applied',
    });
    mockPrisma.applicationStatusHistory.findMany.mockResolvedValue([]);

    await statusEngine.getStatusHistory('app-1', prisma);

    expect(mockPrisma.applicationStatusHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: DEFAULT_PAGE_SIZE,
      }),
    );
  });
});
