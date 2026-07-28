import { PrismaClient } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../lib/logger';
import { cacheService } from './cache/cache.service';
import { storageService } from './storage/storage.service';
import { userService } from './user';
import { dataRetentionService } from './retention/data-retention.service';

type DbClient = PrismaClient;

export class DeletionService {
  constructor(private readonly db: DbClient = prisma) {}

  async requestDeletion(userId: string): Promise<void> {
    await userService.markForDeletion(userId);
  }

  async executeDeletion(userId: string): Promise<void> {
    const counts = await dataRetentionService.deleteUserData(userId);
    await cacheService.delByPrefix(`refresh:${userId}:`);
    await cacheService.delByPrefix(`user:${userId}:`);
    logger.info('[DeletionService] Deletion executed', { userId, counts });

    const resolved = await userService.resolveUserId(userId);
    await this.db.user.updateMany({
      where: { id: resolved },
      data: {
        deletionStatus: 'deleted',
        deletedAt: new Date(),
        deletionCompletedAt: new Date(),
      },
    });
  }

  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const resolved = await userService.resolveUserId(userId);
    const [user, profile, applications, resumes, actions, outcomes, predictions] =
      await Promise.all([
        this.db.user.findUnique({ where: { id: resolved } }),
        this.db.candidateProfile.findUnique({ where: { userId: resolved } }),
        this.db.jobApplication.findMany({ where: { userId: resolved } }),
        this.db.userResume.findMany({ where: { userId: resolved }, include: { resumeHash: true } }),
        this.db.actionEvent.findMany({ where: { userId: resolved } }),
        this.db.outcomeEvent.findMany({ where: { userId: resolved } }),
        this.db.prediction.findMany({ where: { userId: resolved } }),
      ]);

    return {
      user,
      profile,
      applications,
      resumes,
      actions,
      outcomes,
      predictions,
    };
  }

  async setLegalHold(userId: string, reason: string): Promise<void> {
    await userService.setLegalHold(userId, reason);
  }

  async clearLegalHold(userId: string): Promise<void> {
    await userService.clearLegalHold(userId);
  }

  async deleteResumeBlob(key: string, bucket?: string): Promise<void> {
    await storageService.delete(key, bucket);
  }
}

export const deletionService = new DeletionService();
