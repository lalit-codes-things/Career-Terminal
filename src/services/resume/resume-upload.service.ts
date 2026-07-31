/**
 * ResumeUploadService - SHA-256 content-addressed resume storage.
 *
 * Upload flow:
 *  1. Validate the file and compute a content hash.
 *  2. Upload the bytes to quarantine storage first.
 *  3. Create or reuse the clean resume hash record.
 *  4. Create the user resume row in pending state.
 *  5. Enqueue malware scanning.
 *  6. Malware worker promotes clean files and enqueues parsing.
 */
import { createHash } from 'crypto';
import path from 'path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import type { IStorageService } from '../storage/storage.service';
import { storageService as defaultStorageService } from '../storage/storage.service';
import { eventDispatcher } from '../event/event-dispatcher.service';
import { EVENT_TYPES } from '../event/event.types';
import { ValidationError } from '../../errors/app-errors';
import { logger } from '../../lib/logger';
import { sanitizeFilename } from '../../infrastructure/security/utils';
import { userOwnershipFilter } from '../../utils/user-ownership';
import { setRlsUserIdInTransaction } from '../../middleware/rls';
import { userService } from '../user';
import { placementService } from '../placement/placement.service';
import {
  actionService,
  ACTION_TYPES,
  SOURCE_TYPES,
  buildResumeVersionTag,
} from '../action.service';
import { config } from '../../config';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const QUARANTINE_BUCKET = config.s3.bucket;
const CLEAN_BUCKET = config.s3.bucket;

const FILE_SIGNATURES: Record<string, { bytes: number[]; mimeTypes: string[] }> = {
  pdf: {
    bytes: [0x25, 0x50, 0x44, 0x46],
    mimeTypes: ['application/pdf'],
  },
  docx: {
    bytes: [0x50, 0x4b, 0x03, 0x04],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  doc: {
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    mimeTypes: ['application/msword'],
  },
};

export interface ResumeUploadInput {
  userId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
}

export interface ResumeUploadResult {
  userResumeId: string;
  resumeHashId: string;
  storageKey: string;
  presignedUrl: string;
  deduplicated: boolean;
  fileSizeBytes: number;
  hash: string;
  version: number;
  scanningStatus: 'pending' | 'scanning' | 'clean' | 'infected';
  status: 'pending' | 'ready' | 'failed';
}

export interface ResumeVersionInfo {
  id: string;
  version: number;
  isActive: boolean;
  originalName: string;
  supersededAt: Date | null;
  createdAt: Date;
  storageKey: string;
  fileSizeBytes: number;
  hash: string;
  applicationCount: number;
}

export interface ActiveResumeRow {
  userResumeId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  hash: string;
  version: number;
}

export type ApplicationResumeLinkContext =
  { strategy: 'generic' } | { strategy: 'tailored'; tailoredForOpportunityId?: string };

export class ResumeUploadService {
  constructor(private readonly storage: IStorageService = defaultStorageService) {}

  async upload(input: ResumeUploadInput): Promise<ResumeUploadResult> {
    const { userId, fileBuffer, originalFilename, mimeType } = input;
    this.validateFile(fileBuffer, mimeType, originalFilename);
    const safeFilename = sanitizeFilename(originalFilename);
    const hash = createHash('sha256').update(fileBuffer).digest('hex');

    logger.info('[ResumeUpload] File hash computed', {
      userId,
      hash,
      bytes: fileBuffer.length,
    });

    const ext = this.mimeToExtension(mimeType);
    const quarantineBucket = QUARANTINE_BUCKET || CLEAN_BUCKET || 'resume-quarantine';
    const cleanBucket = CLEAN_BUCKET || QUARANTINE_BUCKET || 'resume-clean';

    const quarantineKey = `uploads/quarantine/resumes/${userId}/${hash}-${Date.now()}${ext}`;
    const cleanStorageKey = `uploads/resumes/${hash}${ext}`;
    const existingHash = await prisma.resumeHash.findUnique({ where: { hash } });

    await this.storage.uploadToBucket(quarantineBucket, quarantineKey, fileBuffer, mimeType);

    let resumeHashId: string;
    let deduplicated = false;
    if (existingHash) {
      resumeHashId = existingHash.id;
      deduplicated = true;
      logger.info('[ResumeUpload] Dedup hit after quarantine upload', {
        userId,
        hash,
        cleanStorageKey,
      });
    } else {
      try {
        const newHash = await prisma.resumeHash.create({
          data: {
            hash,
            storageKey: cleanStorageKey,
            storageUrl: cleanStorageKey,
            mimeType,
            sizeBytes: fileBuffer.length,
          },
        });
        resumeHashId = newHash.id;
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
          const retryHash = await prisma.resumeHash.findUnique({ where: { hash } });
          if (!retryHash) {
            throw err;
          }
          resumeHashId = retryHash.id;
          deduplicated = true;
          logger.info('[ResumeUpload] Dedup hit on race condition', {
            userId,
            hash,
            cleanStorageKey,
          });
        } else {
          throw err;
        }
      }
      logger.info('[ResumeUpload] New blob recorded', {
        userId,
        hash,
        cleanStorageKey,
      });
    }

    const userScope = await userService.userScopeFor(userId);
    const placement = await placementService.resolvePlacementContext(userScope.userId);
    const ownershipFilter = userOwnershipFilter(userId);
    const currentMaxRow = await prisma.userResume.findFirst({
      where: ownershipFilter,
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (currentMaxRow?.version ?? 0) + 1;
    const now = new Date();

    // Transactional outbox: the userResume write and the RESUME_UPLOADED event
    // insert commit (or roll back) atomically. RLS is set transaction-scoped so
    // the RLS policies apply even under PgBouncer transaction pooling.
    const outboxEvent = await prisma
      .$transaction(async (tx) => {
        await setRlsUserIdInTransaction(tx, userScope.userId);

        await tx.userResume.updateMany({
          where: { ...ownershipFilter, isActive: true },
          data: { isActive: false, supersededAt: now },
        });

        const newUserResume = await tx.userResume.create({
          data: {
            userId: userScope.userId,
            legacyUserId: userScope.legacyUserId,
            filename: safeFilename,
            s3Key: cleanStorageKey,
            contentType: mimeType,
            originalName: safeFilename,
            resumeHashId,
            isActive: true,
            scanningStatus: 'pending',
            status: 'pending',
            version: nextVersion,
          },
        });

        return eventDispatcher.publishInTransaction(tx, {
          eventType: EVENT_TYPES.RESUME_UPLOADED,
          aggregateId: newUserResume.id,
          aggregateType: 'UserResume',
          userId,
          cellId: placement.cellId,
          payload: {
            userId,
            cellId: placement.cellId,
            userResumeId: newUserResume.id,
            quarantineBucket,
            quarantineKey,
            cleanBucket,
            cleanKey: cleanStorageKey,
            originalFilename: safeFilename,
            mimeType,
            fileHash: hash,
          },
        });
      })
      .catch(async (err) => {
        await this.storage.delete(quarantineKey, quarantineBucket).catch(() => {});
        throw err;
      });

    // Transaction has committed — fast-path dispatch the queue job. If this
    // fails the event stays 'pending' and the OutboxDispatcher retries.
    await eventDispatcher.publishFromEvent(outboxEvent);

    const userResumeId = outboxEvent.payload.userResumeId as string;

    logger.info('[ResumeUpload] Upload queued for malware scan', {
      userId,
      userResumeId,
      deduplicated,
      version: nextVersion,
    });

    try {
      await actionService.recordAction({
        userId,
        actionType: ACTION_TYPES.RESUME_UPDATE,
        strategyTags: [buildResumeVersionTag(nextVersion)],
        context: {
          userResumeId,
          version: nextVersion,
          deduplicated,
          scanningStatus: 'pending',
        },
        sourceType: SOURCE_TYPES.SYSTEM_TRACKED,
        occurredAt: now,
      });
    } catch (error) {
      logger.warn('[ResumeUpload] Failed to record RESUME_UPDATE action', {
        userId,
        userResumeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const presignedUrl = await this.storage.getPresignedUrl(cleanStorageKey);
    return {
      userResumeId,
      resumeHashId,
      storageKey: cleanStorageKey,
      presignedUrl,
      deduplicated,
      fileSizeBytes: fileBuffer.length,
      hash,
      version: nextVersion,
      scanningStatus: 'pending',
      status: 'pending',
    };
  }

  async getActiveResume(userId: string): Promise<{
    userResumeId: string;
    originalName: string;
    presignedUrl: string;
    hash: string;
    fileSizeBytes: number;
    createdAt: Date;
    version: number;
  } | null> {
    const record = await prisma.userResume.findFirst({
      where: { ...userOwnershipFilter(userId), isActive: true },
      include: { resumeHash: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || !record.resumeHash) return null;

    const presignedUrl = await this.storage.getPresignedUrl(record.resumeHash.storageKey);

    return {
      userResumeId: record.id,
      originalName: record.originalName ?? '',
      presignedUrl,
      hash: record.resumeHash.hash,
      fileSizeBytes: record.resumeHash.sizeBytes,
      createdAt: record.createdAt,
      version: record.version,
    };
  }

  async getActiveResumeRow(userId: string): Promise<ActiveResumeRow | null> {
    const record = await prisma.userResume.findFirst({
      where: { ...userOwnershipFilter(userId), isActive: true },
      include: { resumeHash: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || !record.resumeHash) return null;
    return {
      userResumeId: record.id,
      storageKey: record.resumeHash.storageKey,
      originalName: record.originalName ?? '',
      mimeType: record.resumeHash.mimeType,
      fileSizeBytes: record.resumeHash.sizeBytes,
      hash: record.resumeHash.hash,
      version: record.version,
    };
  }

  async listVersions(userId: string): Promise<ResumeVersionInfo[]> {
    const ownershipFilter = userOwnershipFilter(userId);
    const rows = await prisma.userResume.findMany({
      where: ownershipFilter,
      include: {
        resumeHash: true,
        _count: { select: { applicationLinks: true } },
      },
      orderBy: [{ version: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      isActive: r.isActive,
      originalName: r.originalName ?? '',
      supersededAt: r.supersededAt,
      createdAt: r.createdAt,
      storageKey: r.resumeHash?.storageKey ?? '',
      fileSizeBytes: r.resumeHash?.sizeBytes ?? 0,
      hash: r.resumeHash?.hash ?? '',
      applicationCount: r._count.applicationLinks,
    }));
  }

  async deleteVersion(userId: string, userResumeId: string): Promise<void> {
    const ownershipFilter = userOwnershipFilter(userId);
    const row = await prisma.userResume.findFirst({
      where: { id: userResumeId, ...ownershipFilter },
      include: { _count: { select: { applicationLinks: true } } },
    });
    if (!row) return;
    if (row._count.applicationLinks > 0) {
      throw new ValidationError(
        `Cannot delete resume version ${row.version} - it is linked to ${row._count.applicationLinks} application(s).`,
      );
    }
    await prisma.userResume.delete({ where: { id: row.id } });
    logger.info('[ResumeUpload] Resume version deleted', {
      userId,
      userResumeId,
      version: row.version,
    });
  }

  async linkApplicationResume(
    applicationId: string,
    activeRow: ActiveResumeRow,
    opts: {
      appliedAt: Date;
      usageContext?: ApplicationResumeLinkContext;
    },
    db: PrismaClient | Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const snapshotMetadata: Record<string, unknown> = {
      originalName: activeRow.originalName,
      mimeType: activeRow.mimeType,
      sizeBytes: activeRow.fileSizeBytes,
      sha256: activeRow.hash,
      version: activeRow.version,
    };
    await db.applicationResume.upsert({
      where: {
        applicationId_resumeVersionId: {
          applicationId,
          resumeVersionId: activeRow.userResumeId,
        },
      },
      create: {
        applicationId,
        resumeVersionId: activeRow.userResumeId,
        snapshotKey: activeRow.storageKey,
        snapshotMetadata: snapshotMetadata as unknown as never,
        appliedAt: opts.appliedAt,
        usageContext: opts.usageContext as unknown as never,
      },
      update: {},
    });
  }

  async getApplicationResume(applicationId: string): Promise<{
    userResumeId: string;
    version: number;
    originalName: string;
    snapshotKey: string;
    appliedAt: Date;
    usageContext?: unknown;
    fileSizeBytes?: number;
  } | null> {
    const row = await prisma.applicationResume.findFirst({
      where: { applicationId },
      include: { resumeVersion: { include: { resumeHash: true } } },
    });
    if (!row || !row.resumeVersion) return null;
    return {
      userResumeId: row.resumeVersion.id,
      version: row.resumeVersion.version,
      originalName: row.resumeVersion.originalName ?? '',
      snapshotKey: row.snapshotKey,
      appliedAt: row.appliedAt ?? new Date(0),
      usageContext: row.usageContext,
      fileSizeBytes: row.resumeVersion.resumeHash?.sizeBytes ?? 0,
    };
  }

  private validateFile(buffer: Buffer, mimeType: string, filename: string): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new ValidationError(
        `Unsupported file type: ${mimeType}. Allowed types: PDF, DOCX, DOC.`,
      );
    }

    if (buffer.length === 0) {
      throw new ValidationError('Uploaded file is empty.');
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
      );
    }

    const ext = path.extname(filename).toLowerCase();
    const allowedExtensions = new Set(['.pdf', '.docx', '.doc']);
    if (!allowedExtensions.has(ext)) {
      throw new ValidationError(`Invalid file extension: ${ext}. Allowed: .pdf, .docx, .doc`);
    }

    const signature = FILE_SIGNATURES[ext.replace('.', '')];
    if (signature) {
      const matches = signature.bytes.every((byte, index) => buffer[index] === byte);
      if (!matches) {
        throw new ValidationError(
          `File content does not match ${ext} signature. Possible file type spoofing.`,
        );
      }
    }
  }

  private mimeToExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
    };
    return map[mimeType] ?? '';
  }
}

export const resumeUploadService = new ResumeUploadService();
