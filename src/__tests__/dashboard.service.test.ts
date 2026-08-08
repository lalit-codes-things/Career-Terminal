import { prisma } from '../config/database';
import { DashboardService } from '../services/dashboard';
import { type ICacheService } from '../services/cache/cache.service';
import { ApplicationTimelineEventType } from '@prisma/client';
import { JobApplicationStatus } from '../services/job-application';

jest.mock('../config/database', () => {
  const prisma = {
    jobApplication: {
      groupBy: jest.fn(),
    },
    applicationTimeline: {
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

function makeMockCache(): jest.Mocked<ICacheService> {
  const store = new Map<string, unknown>();
  const mockSet = jest.fn(async (key: string, value: unknown, _ttlMs: number): Promise<void> => {
    store.set(key, value);
  });
  const mockGet = jest.fn(async (key: string): Promise<unknown> => (store.has(key) ? store.get(key) : null));
  const mockGetDel = jest.fn(async (_key: string): Promise<unknown> => null);
  const mockDel = jest.fn(async (_key: string): Promise<void> => {});
  const mockDelByPrefix = jest.fn(async (prefix: string): Promise<void> => {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  });
  const mockExists = jest.fn(async (_key: string): Promise<boolean> => false);

  return {
    get: mockGet as jest.MockedFunction<ICacheService['get']>,
    getDel: mockGetDel as jest.MockedFunction<ICacheService['getDel']>,
    set: mockSet as jest.MockedFunction<ICacheService['set']>,
    del: mockDel as jest.MockedFunction<ICacheService['del']>,
    delByPrefix: mockDelByPrefix as jest.MockedFunction<ICacheService['delByPrefix']>,
    exists: mockExists as jest.MockedFunction<ICacheService['exists']>,
  } as unknown as jest.Mocked<ICacheService>;
}

const mockPrisma = prisma as unknown as {
  jobApplication: {
    groupBy: jest.Mock;
  };
  applicationTimeline: {
    findMany: jest.Mock;
  };
};

describe('DashboardService', () => {
  let cache: jest.Mocked<ICacheService>;
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    cache = makeMockCache();
    service = new DashboardService(cache);
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

    const first = await service.getDashboard('user-1', prisma);
    const second = await service.getDashboard('user-1', prisma);

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

    const activity = await service.getActivity('user-1', 5, prisma);

    expect(activity).toHaveLength(1);
    expect(activity[0]?.companyName).toBe('example-organization');
    expect(activity[0]?.eventType).toBe(ApplicationTimelineEventType.INTERVIEW);
    expect(mockPrisma.applicationTimeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          application: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ userId: 'user-1' }),
              expect.objectContaining({ legacyUserId: 'user-1' }),
            ]),
          }),
        }),
        skip: 0,
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

    const interviews = await service.getUpcomingInterviews('user-1', 5, prisma);

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

  it('invalidates cache entries for a user', async () => {
    await service.invalidateUser('user-1');
    expect(cache.delByPrefix).toHaveBeenCalledWith('user-1:');
  });
});
