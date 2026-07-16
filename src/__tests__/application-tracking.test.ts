import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { prisma } from '../config/database';
import { JobApplicationStatus } from '../services/job-application';


jest.mock('../config/database', () => ({
  prisma: {
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
  },
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listApplications', () => {
    it('should query prisma with the correct filters', async () => {
      const mockPrismaJobApps = [{
        id: '1',
        userId: 'user1',
        companyName: 'Stripe',
        companyDomain: 'stripe.com',
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
      }];

      (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue(mockPrismaJobApps);

      const result = await applicationTrackingService.listApplications('user1', { status: JobApplicationStatus.APPLIED, company: 'Str' });

      expect(prisma.jobApplication.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user1',
          status: JobApplicationStatus.APPLIED,
          companyName: { contains: 'Str', mode: 'insensitive' },
        },
        orderBy: { appliedDate: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.company.name).toBe('Stripe');
    });
  });

  describe('getApplication', () => {
    it('should throw an error if application is not found', async () => {
      (prisma.jobApplication.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(applicationTrackingService.getApplication('nonexistent')).rejects.toThrow('Application not found: nonexistent');
    });
  });
});
