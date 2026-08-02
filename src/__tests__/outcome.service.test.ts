import {
  outcomeService,
  OUTCOME_TYPES,
  OUTCOME_CATEGORIES,
  OUTCOME_STATUS,
} from '../services/outcome.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
    outcomeEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    jobApplication: {
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('OutcomeService', () => {
  const userId = 'user-123';
  const applicationId = 'app-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordOutcome', () => {
    it('should derive EXPLICIT status and 0.95 default confidence for EMAIL source, update app status', async () => {
      const now = new Date('2026-07-20T10:00:00Z');
      const eventId = 'evt-1';

      (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue({
        id: eventId,
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.INTERVIEW_SCHEDULED,
        outcomeCategory: OUTCOME_CATEGORIES.NEUTRAL,
        outcomeStatus: OUTCOME_STATUS.EXPLICIT,
        explicit: true,
        sourceType: 'EMAIL',
        sourceId: 'email-789',
        evidence: 'Interview booked for next week',
        confidence: 0.95,
        occurredAt: now,
        recordedAt: now,
        resultingStatus: 'Interviewing',
        version: 1,
        isCurrent: true,
      });
      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.jobApplication.update as jest.Mock).mockResolvedValue({ id: applicationId });

      const result = await outcomeService.recordOutcome({
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.INTERVIEW_SCHEDULED,
        sourceType: 'EMAIL',
        sourceId: 'email-789',
        evidence: 'Interview booked for next week',
        occurredAt: now,
      });

      expect(result.id).toBe(eventId);
      expect(result.outcomeStatus).toBe(OUTCOME_STATUS.EXPLICIT);
      expect(result.explicit).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.outcomeCategory).toBe(OUTCOME_CATEGORIES.NEUTRAL);
      expect(prisma.outcomeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcomeStatus: OUTCOME_STATUS.EXPLICIT,
          explicit: true,
          confidence: 0.95,
          outcomeCategory: OUTCOME_CATEGORIES.NEUTRAL,
          resultingStatus: 'Interviewing',
          sourceType: 'EMAIL',
        }),
      });
      expect(prisma.jobApplication.update).toHaveBeenCalledWith({
        where: { id: applicationId },
        data: expect.objectContaining({ status: 'Interviewing' }),
      });
    });

    it('should derive USER_REPORTED outcomeStatus for MANUAL source with confidence 1.0 override', async () => {
      const now = new Date('2026-07-21T14:00:00Z');
      (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue({
        id: 'evt-2',
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.OFFER_RECEIVED,
        outcomeCategory: OUTCOME_CATEGORIES.POSITIVE,
        outcomeStatus: OUTCOME_STATUS.USER_REPORTED,
        explicit: true,
        sourceType: 'MANUAL',
        confidence: 1.0,
        occurredAt: now,
        resultingStatus: 'Offer',
        isCurrent: true,
      });
      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.jobApplication.update as jest.Mock).mockResolvedValue({ id: applicationId });

      const result = await outcomeService.recordOutcome({
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.OFFER_RECEIVED,
        sourceType: 'MANUAL',
        confidence: 1.0,
        evidence: 'Got a verbal offer from hiring manager',
        occurredAt: now,
      });

      expect(result.outcomeStatus).toBe(OUTCOME_STATUS.USER_REPORTED);
      expect(result.explicit).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.outcomeCategory).toBe(OUTCOME_CATEGORIES.POSITIVE);
      expect(prisma.outcomeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcomeStatus: OUTCOME_STATUS.USER_REPORTED,
          explicit: true,
          confidence: 1.0,
          resultingStatus: 'Offer',
        }),
      });
    });

    it('should derive INFERRED status and 0.5 default confidence for IMPORT source', async () => {
      const now = new Date('2026-07-15T09:00:00Z');
      (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue({
        id: 'evt-3',
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.APPLICATION_SENT,
        outcomeCategory: OUTCOME_CATEGORIES.NEUTRAL,
        outcomeStatus: OUTCOME_STATUS.INFERRED,
        explicit: false,
        sourceType: 'IMPORT',
        confidence: 0.5,
        occurredAt: now,
        resultingStatus: 'Applied',
        isCurrent: true,
      });
      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.jobApplication.update as jest.Mock).mockResolvedValue({ id: applicationId });

      const result = await outcomeService.recordOutcome({
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.APPLICATION_SENT,
        sourceType: 'IMPORT',
        occurredAt: now,
      });

      expect(result.outcomeStatus).toBe(OUTCOME_STATUS.INFERRED);
      expect(result.explicit).toBe(false);
      expect(result.confidence).toBe(0.5);
    });

    it('should always update application status for TERMINAL outcomes even when older event', async () => {
      const olderDate = new Date('2026-07-01T00:00:00Z');
      const newerDate = new Date('2026-07-10T00:00:00Z');

      (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue({
        id: 'evt-rejection',
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.REJECTION_RECEIVED,
        outcomeCategory: OUTCOME_CATEGORIES.NEGATIVE,
        outcomeStatus: OUTCOME_STATUS.EXPLICIT,
        explicit: true,
        sourceType: 'EMAIL',
        confidence: 0.98,
        occurredAt: olderDate,
        resultingStatus: 'Rejected',
        isCurrent: true,
      });

      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue({
        id: 'evt-prior-interview',
        applicationId,
        occurredAt: newerDate,
        outcomeType: OUTCOME_TYPES.INTERVIEW_COMPLETED,
      });
      (prisma.jobApplication.update as jest.Mock).mockResolvedValue({ id: applicationId });

      await outcomeService.recordOutcome({
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.REJECTION_RECEIVED,
        sourceType: 'EMAIL',
        sourceId: 'email-reject-1',
        confidence: 0.98,
        occurredAt: olderDate,
      });

      expect(prisma.jobApplication.update).toHaveBeenCalledWith({
        where: { id: applicationId },
        data: expect.objectContaining({ status: 'Rejected' }),
      });
    });

    it('should NOT update application status for non-terminal older event', async () => {
      const olderDate = new Date('2026-06-20T00:00:00Z');
      const newerDate = new Date('2026-07-10T00:00:00Z');

      (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue({
        id: 'evt-old-contact',
        outcomeType: OUTCOME_TYPES.RECRUITER_CONTACT,
        occurredAt: olderDate,
        resultingStatus: 'Recruiter Contact',
        isCurrent: true,
      });
      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue({
        id: 'evt-newer-interview',
        occurredAt: newerDate,
        outcomeType: OUTCOME_TYPES.INTERVIEW_SCHEDULED,
      });

      await outcomeService.recordOutcome({
        applicationId,
        userId,
        outcomeType: OUTCOME_TYPES.RECRUITER_CONTACT,
        sourceType: 'EMAIL',
        occurredAt: olderDate,
      });

      expect(prisma.jobApplication.update).not.toHaveBeenCalled();
    });

    it('should fall back to NEUTRAL category and Unknown status for unknown outcomeType', async () => {
      const now = new Date('2026-07-22T00:00:00Z');
      const createSpy = (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue({
        id: 'evt-custom',
        outcomeType: 'CUSTOM_EVENT',
        outcomeCategory: OUTCOME_CATEGORIES.NEUTRAL,
        resultingStatus: 'Unknown',
        isCurrent: true,
      });
      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.jobApplication.update as jest.Mock).mockResolvedValue({ id: applicationId });

      await outcomeService.recordOutcome({
        applicationId,
        userId,
        outcomeType: 'CUSTOM_EVENT',
        sourceType: 'MANUAL',
        occurredAt: now,
      });

      const callData = createSpy.mock.calls[0][0].data;
      expect(callData.outcomeCategory).toBe(OUTCOME_CATEGORIES.NEUTRAL);
      expect(callData.resultingStatus).toBe('Unknown');
    });
  });

  describe('getApplicationTimeline', () => {
    it('should return events ordered by occurredAt ascending filtering isCurrent and appId', async () => {
      const events = [
        { id: 'e1', occurredAt: new Date('2026-07-01') },
        { id: 'e2', occurredAt: new Date('2026-07-05') },
        { id: 'e3', occurredAt: new Date('2026-07-10') },
      ];
      (prisma.outcomeEvent.findMany as jest.Mock).mockResolvedValue(events);

      const result = await outcomeService.getApplicationTimeline(applicationId);

      expect(result).toBe(events);
      expect(prisma.outcomeEvent.findMany).toHaveBeenCalledWith({
        where: { applicationId, isCurrent: true },
        orderBy: { occurredAt: 'asc' },
      });
    });
  });

  describe('getCurrentStatus', () => {
    it('should return the most recent event (occurredAt desc) or null', async () => {
      const latest = {
        id: 'e-latest',
        outcomeType: OUTCOME_TYPES.OFFER_RECEIVED,
        occurredAt: new Date('2026-07-20'),
      };
      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue(latest);

      const result = await outcomeService.getCurrentStatus(applicationId);
      expect(result).toBe(latest);
      expect(prisma.outcomeEvent.findFirst).toHaveBeenCalledWith({
        where: { applicationId, isCurrent: true },
        orderBy: { occurredAt: 'desc' },
      });
    });

    it('should return null when there are no events', async () => {
      (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await outcomeService.getCurrentStatus(applicationId);
      expect(result).toBeNull();
    });
  });

  describe('getOutcomesByTypeAndRange', () => {
    it('should filter by userId, outcomeTypes in list, and time range', async () => {
      const start = new Date('2026-07-01');
      const end = new Date('2026-07-31');
      const types = [OUTCOME_TYPES.INTERVIEW_SCHEDULED, OUTCOME_TYPES.OFFER_RECEIVED];
      const rows = [{ id: 'r1' }, { id: 'r2' }];
      (prisma.outcomeEvent.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await outcomeService.getOutcomesByTypeAndRange(userId, types, start, end);
      expect(result).toBe(rows);
      expect(prisma.outcomeEvent.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          outcomeType: { in: types },
          occurredAt: { gte: start, lte: end },
          isCurrent: true,
        },
        orderBy: { occurredAt: 'desc' },
      });
    });
  });
});
