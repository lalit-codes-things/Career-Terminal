import { prisma } from '../config/database';
import {
  ApplicationTimelineEventType,
  applicationTimelineService,
} from '../services/application-timeline';
import { JobEmailCategory } from '../services/job-intelligence';
import { DEFAULT_PAGE_SIZE } from '../domain/pagination';

jest.mock('../config/database', () => {
  const prisma = {
    applicationTimeline: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
  applicationTimeline: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

describe('ApplicationTimelineService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds email timeline events from job emails', () => {
    const event = applicationTimelineService.buildEmailTimelineEvent({
      applicationId: 'app-1',
      email: {
        emailId: 'email-1',
        sender: 'jobs@stripe.com',
        subject: 'Your interview is scheduled',
        bodyText: 'This will be a phone screen.',
        receivedAt: new Date('2026-01-02T10:00:00.000Z'),
        threadId: 'thread-1',
      },
      classification: {
        emailId: 'email-1',
        category: JobEmailCategory.INTERVIEW_INVITATION,
        confidence: 0.91,
        detectedCompany: 'example-organization',
        detectedRole: 'Engineer',
      },
    });

    expect(event?.eventType).toBe(ApplicationTimelineEventType.PHONE_SCREEN);
    expect(event?.sourceEmailId).toBe('email-1');
    expect(event?.timestamp.toISOString()).toBe('2026-01-02T10:00:00.000Z');
  });

  it('returns application timelines in chronological order', async () => {
    mockPrisma.applicationTimeline.findMany.mockResolvedValue([
      {
        id: 'evt-2',
        applicationId: 'app-1',
        eventType: ApplicationTimelineEventType.INTERVIEW,
        timestamp: new Date('2026-01-03T00:00:00.000Z'),
        sourceEmailId: 'email-2',
        metadata: null,
        description: null,
      },
      {
        id: 'evt-1',
        applicationId: 'app-1',
        eventType: ApplicationTimelineEventType.APPLICATION_SUBMITTED,
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        sourceEmailId: 'email-1',
        metadata: null,
        description: null,
      },
    ]);

    const timeline = await applicationTimelineService.listTimeline('app-1');

    expect(mockPrisma.applicationTimeline.findMany).toHaveBeenCalledWith({
      where: { applicationId: 'app-1' },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      skip: 0,
      take: 25,
    });
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.id).toBe('evt-1');
  });

  it('patches existing timeline events', async () => {
    mockPrisma.applicationTimeline.findUnique.mockResolvedValue({
      id: 'evt-1',
      applicationId: 'app-1',
      eventType: ApplicationTimelineEventType.APPLICATION_SUBMITTED,
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      sourceEmailId: 'email-1',
      metadata: null,
      description: null,
    });
    mockPrisma.applicationTimeline.update.mockResolvedValue({
      id: 'evt-1',
      applicationId: 'app-1',
      eventType: ApplicationTimelineEventType.INTERVIEW,
      timestamp: new Date('2026-01-02T00:00:00.000Z'),
      sourceEmailId: 'email-1',
      metadata: { note: 'Updated' },
      description: 'Updated',
    });

    const event = await applicationTimelineService.patchTimelineEvent('evt-1', {
      eventType: ApplicationTimelineEventType.INTERVIEW,
      metadata: { note: 'Updated' },
    });

    expect(event.eventType).toBe(ApplicationTimelineEventType.INTERVIEW);
    expect(mockPrisma.applicationTimeline.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: {
        eventType: ApplicationTimelineEventType.INTERVIEW,
        timestamp: undefined,
        sourceEmailId: undefined,
        metadata: { note: 'Updated' },
        description: undefined,
      },
    });
  });

  it('applies default pagination when no pagination args are passed to listTimeline', async () => {
    mockPrisma.applicationTimeline.findMany.mockResolvedValue([]);

    await applicationTimelineService.listTimeline('app-1');

    expect(mockPrisma.applicationTimeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: DEFAULT_PAGE_SIZE,
      }),
    );
  });
});
