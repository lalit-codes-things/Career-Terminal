import { prisma } from '../config/database';
import { dashboardService } from '../services/dashboard';
import { ApplicationTimelineEventType } from '@prisma/client';
import { JobApplicationStatus } from '../services/job-application';

jest.mock('../config/database', () => ({
  prisma: {
    jobApplication: {
      groupBy: jest.fn(),
    },
    applicationTimeline: {
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as {
  jobApplication: {
    groupBy: jest.Mock;
  };
  applicationTimeline: {
    findMany: jest.Mock;
  };
};

describe('DashboardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dashboardService.invalidateUser('user-1');
  });

  it('builds summary metrics from grouped application counts and caches them', async () => {
    mockPrisma.jobApplication.groupBy.mockResolvedValue([
      { status: JobApplicationStatus.APPLIED, _count: { _all: 3 } },
      { status: JobApplicationStatus.SCREENING, _count: { _all: 2 } },
      { status: JobApplicationStatus.ASSESSMENT, _count: { _all: 1 } },
      { status: JobApplicationStatus.INTERVIEW, _count: { _all: 4 } },
      { status: JobApplicationStatus.OFFER, _count: { _all: 1 } },
      { status: JobApplicationStatus.REJECTED, _count: { _all: 2 } },
      { status: JobApplicationStatus.WITHDRAWN, _count: { _all: 1 } },
    ]);

    const first = await dashboardService.getDashboard('user-1', prisma);
    const second = await dashboardService.getDashboard('user-1', prisma);

    expect(first).toEqual(second);
    expect(first.totalApplications).toBe(14);
    expect(first.activeApplications).toBe(11);
    expect(first.interviews).toBe(4);
    expect(first.offers).toBe(1);
    expect(first.rejections).toBe(2);
    expect(first.pendingAssessments).toBe(1);
    expect(first.responseRate).toBeCloseTo(11 / 14);
    expect(mockPrisma.jobApplication.groupBy).toHaveBeenCalledTimes(1);
  });

  it('returns recent activity events', async () => {
    mockPrisma.applicationTimeline.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        applicationId: 'app-1',
        eventType: ApplicationTimelineEventType.INTERVIEW,
        timestamp: new Date('2026-07-16T10:00:00.000Z'),
        sourceEmailId: 'email-1',
        metadata: null,
        description: 'Interview scheduled',
        application: {
          companyName: 'example-organization',
          roleTitle: 'Engineer',
        },
      },
    ]);

    const activity = await dashboardService.getActivity('user-1', 5, prisma);

    expect(activity).toHaveLength(1);
    expect(activity[0]?.companyName).toBe('example-organization');
    expect(activity[0]?.eventType).toBe(ApplicationTimelineEventType.INTERVIEW);
    expect(mockPrisma.applicationTimeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          application: expect.objectContaining({
            OR: [{ userId: 'user-1' }, { legacyUserId: 'user-1' }],
          }),
        }),
        take: 5,
      }),
    );
  });

  it('returns upcoming interviews in chronological order', async () => {
    mockPrisma.applicationTimeline.findMany.mockResolvedValue([
      {
        id: 'evt-2',
        applicationId: 'app-2',
        eventType: ApplicationTimelineEventType.FINAL_INTERVIEW,
        timestamp: new Date('2026-07-20T10:00:00.000Z'),
        sourceEmailId: null,
        metadata: null,
        description: 'Final round',
        application: {
          companyName: 'Meta',
          roleTitle: 'Product Manager',
        },
      },
    ]);

    const interviews = await dashboardService.getUpcomingInterviews('user-1', 5, prisma);

    expect(interviews).toHaveLength(1);
    expect(interviews[0]?.companyName).toBe('Meta');
    expect(mockPrisma.applicationTimeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: expect.objectContaining({
            in: [
              ApplicationTimelineEventType.PHONE_SCREEN,
              ApplicationTimelineEventType.INTERVIEW,
              ApplicationTimelineEventType.FINAL_INTERVIEW,
            ],
          }),
        }),
        take: 5,
      }),
    );
  });
});
