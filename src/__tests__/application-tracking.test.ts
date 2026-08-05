import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { JobApplicationStatus } from '../services/job-application';

// jest.mock is hoisted before imports, so we cannot reference external variables
// in the factory. Instead we create the mock object inline and retrieve it with
// jest.requireMock() in tests.
jest.mock('../config/database', () => {
  const mockDb = {
    jobApplication: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    emailMessage: {
      findMany: jest.fn(),
    },
    applicationTimeline: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return {
    prisma: mockDb,
    prismaReplica: mockDb,
    dbRouter: {
      read: jest.fn().mockReturnValue(mockDb),
      write: jest.fn().mockReturnValue(mockDb),
      getHealth: jest.fn().mockReturnValue({
        replicaConfigured: false,
        replicaHealthy: true,
        failureCount: 0,
      }),
    },
  };
});

jest.mock('../services/job-application', () => {
  const original = jest.requireActual('../services/job-application');
  return {
    ...original,
    jobApplicationExtractor: {
      extract: jest.fn(),
    },
  };
});

describe('ApplicationTrackingService', () => {
  // Helper to get the mocked database module
  type MockDb = {
    prisma: {
      jobApplication: {
        findMany: jest.Mock;
        findUnique: jest.Mock;
        findFirst: jest.Mock;
        update: jest.Mock;
        create: jest.Mock;
      };
      applicationTimeline: {
        findMany: jest.Mock;
      };
      $transaction: jest.Mock;
    };
    dbRouter: {
      read: jest.Mock;
      write: jest.Mock;
    };
  };
  function getMockDb(): MockDb {
    return jest.requireMock('../config/database');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore dbRouter.read() and dbRouter.write() to return prisma after clearAllMocks
    const { prisma, dbRouter } = getMockDb();
    dbRouter.read.mockReturnValue(prisma);
    dbRouter.write.mockReturnValue(prisma);
  });

  describe('listApplications', () => {
    it('should query prisma with the correct filters', async () => {
      const { prisma } = getMockDb();

      const mockPrismaJobApps = [
        {
          id: '1',
          userId: 'user1',
          companyName: 'example-organization',
          companyDomain: 'example-organization.com',
          roleTitle: 'Engineer',
          roleDepartment: 'Engineering',
          status: JobApplicationStatus.APPLIED,
          appliedDate: new Date(),
          recruiterName: 'Maya',
          recruiterEmail: 'maya@stripe.com',
          sourceEmailId: 'email1',
          location: 'Remote',
          employmentType: 'Full-time',
          currentStage: 'Applied',
          interviewRounds: 0,
          deadlines: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      prisma.jobApplication.findMany.mockResolvedValue(mockPrismaJobApps);

      const result = await applicationTrackingService.listApplications('user1', {
        status: JobApplicationStatus.APPLIED,
        company: 'Str',
      });

      expect(prisma.jobApplication.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ userId: 'user1' }, { legacyUserId: 'user1' }],
          status: JobApplicationStatus.APPLIED,
          companyName: { contains: 'Str', mode: 'insensitive' },
        },
        orderBy: { appliedDate: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.company.name).toBe('example-organization');
    });
  });

  describe('getApplication', () => {
    it('should throw an error if application is not found', async () => {
      const { prisma } = getMockDb();

      // The service uses findFirst (not findUnique) for getApplication —
      // it queries by BOTH id AND userId as a combined filter, which
      // requires findFirst rather than findUnique.
      prisma.jobApplication.findFirst.mockResolvedValue(null);

      await expect(
        applicationTrackingService.getApplication('user1', 'nonexistent'),
      ).rejects.toThrow('Application not found: nonexistent');
    });
  });
});
