/**
 * UserService — global identity layer for Career Terminal.
 *
 * Manages user records, candidate profiles, consent tracking, and the
 * legacy → internal UUID mapping used during migration.
 */
import { v7 as uuidv7 } from 'uuid';
import type { CandidateProfile, User } from '@prisma/client';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { isValidUuid } from '../../utils/user-ownership';
import { logger } from '../../lib/logger';
import { computeShardKey, resolveRegionFromHints } from '../placement/placement.service';
import type { RegionResolutionHints } from '../placement/placement.service';
import { cellService } from '../cell/cell.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CandidateProfileUpdate = {
  readonly fullName?: string;
  readonly phone?: string | null;
  readonly location?: string | null;
  readonly timezone?: string | null;
  readonly preferences?: unknown;
  readonly careerGoals?: unknown;
};

export class UserService {
  constructor(private readonly db: DbClient = prisma) {}

  /**
   * Idempotently resolve or create a user for an external identifier.
   * Reuses the external UUID as the internal id when valid; otherwise
   * creates a v7 UUID and stores a mapping row.
   *
   * Placement metadata (region, data_residency_region, shard_key) is
   * written at creation time so the row is ready for the data-plane
   * router immediately — no subsequent backfill round-trip required.
   */
  async getOrCreateUser(
    externalUserId: string,
    regionOrHints: string | RegionResolutionHints = 'us-east-1',
    options?: { tenantId?: string },
  ): Promise<User> {
    const internalId = await this.resolveUserId(externalUserId);

    const existing = await this.db.user.findUnique({ where: { id: internalId } });
    if (existing) {
      return existing;
    }

    const resolvedRegion =
      typeof regionOrHints === 'string' ? regionOrHints : resolveRegionFromHints(regionOrHints);

    const shardKey = computeShardKey(internalId);

    try {
      const cell = await cellService.resolveUserHomeCell(internalId, resolvedRegion);
      const user = await this.db.user.create({
        data: {
          id: internalId,
          cellId: cell.cellId,
          region: resolvedRegion,
          dataResidencyRegion: resolvedRegion,
          shardKey,
          tenantId: options?.tenantId ?? null,
        },
      });

      await this.db.candidateProfile.create({
        data: { userId: user.id },
      });

      if (internalId !== externalUserId) {
        await this.db.userIdMapping.upsert({
          where: { externalId: externalUserId },
          create: { externalId: externalUserId, userId: internalId },
          update: { userId: internalId },
        });
      }

      logger.info('[UserService] User created', {
        userId: user.id,
        externalUserId,
        region: resolvedRegion,
        shardKey,
        cellId: cell.cellId,
        tenantId: options?.tenantId ?? null,
      });

      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.db.user.findUnique({ where: { id: internalId } });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /** Resolve an external/legacy id to the internal UUID. */
  async resolveUserId(externalUserId: string): Promise<string> {
    if (isValidUuid(externalUserId)) {
      const byId = await this.db.user.findUnique({
        where: { id: externalUserId },
        select: { id: true },
      });
      if (byId) return byId.id;
      return externalUserId;
    }

    const mapping = await this.db.userIdMapping.findUnique({
      where: { externalId: externalUserId },
      select: { userId: true },
    });
    if (mapping) return mapping.userId;

    return uuidv7();
  }

  async getProfile(userId: string): Promise<CandidateProfile> {
    const internalId = await this.resolveUserId(userId);
    const profile = await this.db.candidateProfile.findUnique({
      where: { userId: internalId },
    });

    if (!profile) {
      throw new NotFoundError('CandidateProfile', internalId);
    }

    return profile;
  }

  async updateProfile(userId: string, data: CandidateProfileUpdate): Promise<CandidateProfile> {
    const internalId = await this.resolveUserId(userId);
    await this.getOrCreateUser(userId);

    const create: Prisma.CandidateProfileUncheckedCreateInput = {
      userId: internalId,
      fullName: data.fullName ?? null,
      phone: data.phone ?? null,
      location: data.location ?? null,
      timezone: data.timezone ?? null,
      preferences: data.preferences ?? {},
      careerGoals: data.careerGoals != null ? data.careerGoals : undefined,
    };
    const update: Prisma.CandidateProfileUpdateInput = {
      fullName: data.fullName !== undefined ? data.fullName : undefined,
      phone: data.phone !== undefined ? data.phone : undefined,
      location: data.location !== undefined ? data.location : undefined,
      timezone: data.timezone !== undefined ? data.timezone : undefined,
      preferences:
        data.preferences !== undefined ? (data.preferences as Prisma.InputJsonValue) : undefined,
      careerGoals:
        data.careerGoals !== undefined ? (data.careerGoals as Prisma.InputJsonValue) : undefined,
    };

    return this.db.candidateProfile.upsert({
      where: { userId: internalId },
      create,
      update,
    });
  }

  async updateConsent(userId: string, version: string): Promise<void> {
    const internalId = await this.resolveUserId(userId);
    await this.getOrCreateUser(userId);

    await this.db.user.update({
      where: { id: internalId },
      data: {
        consentVersion: version,
        consentGrantedAt: new Date(),
      },
    });
  }

  async markForDeletion(userId: string): Promise<void> {
    const internalId = await this.resolveUserId(userId);
    const user = await this.db.user.findUnique({ where: { id: internalId } });

    if (!user) {
      throw new NotFoundError('User', internalId);
    }

    await this.db.user.update({
      where: { id: internalId },
      data: {
        deletionStatus: 'pending_deletion',
        deletedAt: new Date(),
        deletionRequestedAt: new Date(),
      },
    });
  }

  async setLegalHold(userId: string, reason: string): Promise<void> {
    const internalId = await this.resolveUserId(userId);
    await this.db.user.update({
      where: { id: internalId },
      data: {
        deletionStatus: 'legal_hold',
        legalHoldReason: reason,
      },
    });
  }

  async clearLegalHold(userId: string): Promise<void> {
    const internalId = await this.resolveUserId(userId);
    await this.db.user.update({
      where: { id: internalId },
      data: {
        deletionStatus: 'active',
        legalHoldReason: null,
      },
    });
  }

  /** Fields for creating user-scoped records (FK + legacy id). */
  async userScopeFor(externalUserId: string): Promise<{
    userId: string;
    legacyUserId: string;
    resolvedUserId: string;
  }> {
    const resolvedUserId = await this.resolveUserId(externalUserId);
    return {
      userId: resolvedUserId,
      legacyUserId: externalUserId,
      resolvedUserId,
    };
  }
}

export const userService = new UserService();
