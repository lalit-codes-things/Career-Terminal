import { actionService, ACTION_TYPES, SOURCE_TYPES } from '../services/action.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
    actionEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('ActionService', () => {
  const userId = 'user-123';
  const applicationId = 'app-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordAction', () => {
    it('should create an ActionEvent with default values', async () => {
      const now = new Date('2026-07-27T10:00:00Z');
      const eventId = 'act-1';

      (prisma.actionEvent.create as jest.Mock).mockResolvedValue({
        id: eventId,
        userId,
        actionType: ACTION_TYPES.APPLY,
        sourceType: SOURCE_TYPES.USER_ACTION,
        occurredAt: now,
        strategyTags: [],
      });

      const result = await actionService.recordAction({
        userId,
        actionType: ACTION_TYPES.APPLY,
        occurredAt: now,
      });

      expect(result.id).toBe(eventId);
      expect(prisma.actionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          actionType: ACTION_TYPES.APPLY,
          sourceType: SOURCE_TYPES.USER_ACTION,
          occurredAt: now,
          strategyTags: [],
        }),
      });
    });

    it('should include strategy tags and context', async () => {
      const now = new Date('2026-07-27T10:00:00Z');
      const tags = ['resume_v1', 'targeted_startup'];
      const context = { browser: 'chrome', version: '1.0' };

      (prisma.actionEvent.create as jest.Mock).mockResolvedValue({
        id: 'act-2',
        userId,
        actionType: ACTION_TYPES.RESUME_UPDATE,
        strategyTags: tags,
        context,
      });

      await actionService.recordAction({
        userId,
        actionType: ACTION_TYPES.RESUME_UPDATE,
        strategyTags: tags,
        context,
        occurredAt: now,
      });

      expect(prisma.actionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          strategyTags: tags,
          context: context,
        }),
      });
    });

    it('should throw if userId is missing', async () => {
      await expect(
        actionService.recordAction({
          userId: '',
          actionType: ACTION_TYPES.APPLY,
        }),
      ).rejects.toThrow('userId is required');
    });

    it('should throw if actionType is missing', async () => {
      await expect(
        actionService.recordAction({
          userId,
          actionType: '',
        }),
      ).rejects.toThrow('actionType is required');
    });
  });

  describe('getUserActions', () => {
    it('should fetch actions for a user with filters', async () => {
      const actions = [{ id: 'a1' }, { id: 'a2' }];
      (prisma.actionEvent.findMany as jest.Mock).mockResolvedValue(actions);

      const result = await actionService.getUserActions(userId, {
        actionType: ACTION_TYPES.APPLY,
      });

      expect(result).toBe(actions);
      expect(prisma.actionEvent.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          actionType: ACTION_TYPES.APPLY,
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('getApplicationActions', () => {
    it('should fetch actions for an application', async () => {
      const actions = [{ id: 'a1' }];
      (prisma.actionEvent.findMany as jest.Mock).mockResolvedValue(actions);

      const result = await actionService.getApplicationActions(applicationId);

      expect(result).toBe(actions);
      expect(prisma.actionEvent.findMany).toHaveBeenCalledWith({
        where: { applicationId },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('addStrategyTag', () => {
    it('should add a tag to an existing action event', async () => {
      const eventId = 'act-1';
      const tag = 'new-strategy';
      (prisma.actionEvent.findUnique as jest.Mock).mockResolvedValue({
        id: eventId,
        strategyTags: ['old-tag'],
      });
      (prisma.actionEvent.update as jest.Mock).mockResolvedValue({
        id: eventId,
        strategyTags: ['old-tag', tag],
      });

      await actionService.addStrategyTag(eventId, tag);

      expect(prisma.actionEvent.update).toHaveBeenCalledWith({
        where: { id: eventId },
        data: {
          strategyTags: { push: tag },
        },
      });
    });

    it('should not add tag if it already exists', async () => {
      const eventId = 'act-1';
      const tag = 'existing-tag';
      (prisma.actionEvent.findUnique as jest.Mock).mockResolvedValue({
        id: eventId,
        strategyTags: [tag],
      });

      await actionService.addStrategyTag(eventId, tag);

      expect(prisma.actionEvent.update).not.toHaveBeenCalled();
    });
  });
});
