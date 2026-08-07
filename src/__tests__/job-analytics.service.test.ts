import { jobAnalyticsService } from '../services/job-analytics/job-analytics.service';
import { prisma } from '../config/database';
import { JobApplicationStatus } from '../services/job-application';

jest.mock('../config/database', () => {
  const prisma = {
    jobApplication: {
      findMany: jest.fn(),
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

describe('JobAnalyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return zeros when user has no applications', async () => {
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValueOnce([]);

    const result = await jobAnalyticsService.getAnalytics('user-1');

    expect(result).toEqual({
      applications: 0,
      responses: 0,
      interviews: 0,
      offers: 0,
      conversionRates: {
        responseRate: 0,
        interviewRate: 0,
        offerRate: 0,
      },
      averageResponseTimeDays: 0,
      companiesAppliedTo: 0,
      mostSuccessfulJobCategories: [],
    });
  });

  it('should calculate correct metrics for a mix of applications', async () => {
    const mockApplications = [
      {
        id: '1',
        userId: 'user-1',
        companyDomain: 'google.com',
        roleDepartment: 'Engineering',
        status: JobApplicationStatus.APPLIED,
        appliedDate: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        timeline: [
          {
            eventType: 'EMAIL_PROCESSED',
            description: 'Processed email',
            timestamp: new Date('2026-07-01T00:00:00Z'),
          },
        ],
      },
      {
        id: '2',
        userId: 'user-1',
        companyDomain: 'meta.com',
        roleDepartment: 'Engineering',
        status: JobApplicationStatus.INTERVIEW,
        appliedDate: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-05T00:00:00Z'),
        timeline: [
          {
            eventType: 'STATUS_CHANGED',
            description: 'Application status updated to SCREENING',
            timestamp: new Date('2026-07-03T00:00:00Z'),
          }, // 2 days response time
          {
            eventType: 'STATUS_CHANGED',
            description: 'Application status updated to INTERVIEW',
            timestamp: new Date('2026-07-05T00:00:00Z'),
          },
        ],
      },
      {
        id: '3',
        userId: 'user-1',
        companyDomain: 'amazon.com',
        roleDepartment: 'Product',
        status: JobApplicationStatus.REJECTED,
        appliedDate: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-07T00:00:00Z'), // 6 days response time via fallback
        timeline: [], // Testing fallback
      },
      {
        id: '4',
        userId: 'user-1',
        companyDomain: 'meta.com',
        roleDepartment: 'Design',
        status: JobApplicationStatus.OFFER,
        appliedDate: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-10T00:00:00Z'),
        timeline: [
          {
            eventType: 'STATUS_CHANGED',
            description: 'Application status updated to INTERVIEW',
            timestamp: new Date('2026-07-05T00:00:00Z'),
          }, // 4 days response
          {
            eventType: 'STATUS_CHANGED',
            description: 'Application status updated to OFFER',
            timestamp: new Date('2026-07-10T00:00:00Z'),
          },
        ],
      },
    ];

    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValueOnce(mockApplications);

    const result = await jobAnalyticsService.getAnalytics('user-1');

    // Total applications: 4
    // Responses: 3 (app 2, 3, 4)
    // Interviews: 2 (app 2, 4)
    // Offers: 1 (app 4)

    // Response times:
    // App 2: 2 days
    // App 3: 6 days (fallback)
    // App 4: 4 days (from INTERVIEW event)
    // Average: (2 + 6 + 4) / 3 = 12 / 3 = 4.0 days

    // Unique companies: 3 (google.com, meta.com, amazon.com)

    // Categories:
    // Engineering: 2 apps, 1 interview (50%)
    // Design: 1 app, 1 interview (100%)
    // Product: 1 app, 0 interviews (0%)

    expect(result.applications).toBe(4);
    expect(result.responses).toBe(3);
    expect(result.interviews).toBe(2);
    expect(result.offers).toBe(1);

    expect(result.conversionRates.responseRate).toBe(0.75);
    expect(result.conversionRates.interviewRate).toBe(0.5);
    expect(result.conversionRates.offerRate).toBe(0.25);

    expect(result.averageResponseTimeDays).toBe(4);
    expect(result.companiesAppliedTo).toBe(3);

    expect(result.mostSuccessfulJobCategories).toHaveLength(3);
    expect(result.mostSuccessfulJobCategories[0]!.category).toBe('Design'); // 100% interview rate
    expect(result.mostSuccessfulJobCategories[0]!.interviewRate).toBe(1);

    expect(result.mostSuccessfulJobCategories[1]!.category).toBe('Engineering'); // 50% interview rate
    expect(result.mostSuccessfulJobCategories[1]!.interviewRate).toBe(0.5);

    expect(result.mostSuccessfulJobCategories[2]!.category).toBe('Product'); // 0% interview rate
    expect(result.mostSuccessfulJobCategories[2]!.interviewRate).toBe(0);
  });
});
