/**
 * ResumeUploadService — SHA-256 content-addressed resume storage.
 *
 * Deduplication algorithm:
 *
 *  1. Compute SHA-256 hash of the raw file buffer (before any transformation).
 *  2. Look up the hash in the `resume_hashes` table (indexed, fast).
 *  3a. CACHE HIT  → skip S3 upload entirely. Create a new `user_resumes` row
 *                   pointing at the existing `resume_hashes` row.
 *  3b. CACHE MISS → upload buffer to S3 at key `uploads/resumes/<hash>.<ext>`,
 *                   insert a new `resume_hashes` row, then create `user_resumes`.
 *
 * This means 1,000 users uploading the same generic "Harvard template" resume
 * produce exactly 1 S3 object and 1 resume_hashes row, but 1,000 user_resumes
 * rows (one per user-upload event). Storage savings are massive at scale.
 *
 * After a successful upload/dedup the service enqueues a resume-parsing job
 * so NLP extraction runs asynchronously without blocking the HTTP response.
 */
import { createHash } from 'crypto';
import path from 'path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import type { IStorageService } from '../storage/storage.service';
import { storageService as defaultStorageService } from '../storage/storage.service';
import { queueService } from '../queue/queue.service';
import { ValidationError } from '../../errors/app-errors';
import { logger } from '../../lib/logger';
import { sanitizeFilename } from '../../infrastructure/security/utils';
import { userOwnershipFilter } from '../../utils/user-ownership';
import { userService } from '../user';
import {
  actionService,
  ACTION_TYPES,
  SOURCE_TYPES,
  buildResumeVersionTag,
} from '../action.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** Short-lived pre-signed URL for immediate client download. */
  presignedUrl: string;
  /** true = file already existed in S3; false = freshly uploaded. */
  deduplicated: boolean;
  fileSizeBytes: number;
  hash: string;
  /** The version number assigned to this upload for the user. */
  version: number;
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
  /** How many applications have been submitted using this resume version. */
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
  | { strategy: 'generic' }
  | { strategy: 'tailored'; tailoredForOpportunityId?: string };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ResumeUploadService {
  constructor(private readonly storage: IStorageService = defaultStorageService) {}

  /**
   * Upload a resume with full SHA-256 deduplication.
   *
   * @throws ValidationError  if the file type or size is invalid.
   */
  async upload(input: ResumeUploadInput): Promise<ResumeUploadResult> {
    const { userId, fileBuffer, originalFilename, mimeType } = input;

    // ── Validate ──────────────────────────────────────────────────────────
    this.validateFile(fileBuffer, mimeType, originalFilename);
    const safeFilename = sanitizeFilename(originalFilename);

    // ── Step 1: Compute SHA-256 hash ──────────────────────────────────────
    const hash = createHash('sha256').update(fileBuffer).digest('hex');

    logger.info('[ResumeUpload] File hash computed', {
      userId,
      hash,
      bytes: fileBuffer.length,
    });

    // ── Step 2: Check resume_hashes table for existing blob ───────────────
    const existingHash = await prisma.resumeHash.findUnique({
      where: { hash },
    });

    let resumeHashId: string;
    let storageKey: string;
    let presignedUrl: string;
    let deduplicated: boolean;

    if (existingHash) {
      // ── Step 3a: Dedup hit — reuse existing S3 object ────────────────
      resumeHashId = existingHash.id;
      storageKey = existingHash.storageKey;
      deduplicated = true;

      // Generate a fresh presigned URL (the stored one may have expired)
      presignedUrl = await this.storage.getPresignedUrl(storageKey);

      logger.info('[ResumeUpload] Dedup hit — skipping S3 upload', {
        userId,
        hash,
        storageKey,
      });
    } else {
      // ── Step 3b: New blob — upload to S3 and record the hash ─────────
      const ext = this.mimeToExtension(mimeType);
      storageKey = `uploads/resumes/${hash}${ext}`;

      const uploadResult = await this.storage.upload(storageKey, fileBuffer, mimeType);
      presignedUrl = uploadResult.presignedUrl;
      deduplicated = false;

      // Persist hash record (unique constraint prevents races)
      const newHash = await prisma.resumeHash.create({
        data: {
          hash,
          storageKey,
          storageUrl: storageKey, // store the key; presigned URLs are ephemeral
          mimeType,
          sizeBytes: fileBuffer.length,
        },
      });

      resumeHashId = newHash.id;

      logger.info('[ResumeUpload] New blob uploaded and hash recorded', {
        userId,
        hash,
        storageKey,
      });
    }

    // ── Step 4: Determine next version, mark previous active as superseded ─
    const userScope = await userService.userScopeFor(userId);
    const ownershipFilter = userOwnershipFilter(userId);

    const currentMaxRow = await prisma.userResume.findFirst({
      where: ownershipFilter,
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (currentMaxRow?.version ?? 0) + 1;
    const now = new Date();

    await prisma.userResume.updateMany({
      where: { ...ownershipFilter, isActive: true },
      data: { isActive: false, supersededAt: now },
    });

    // ── Step 5: Create user_resumes record (with version) ─────────────────
    const userResume = await prisma.userResume.create({
      data: {
        userId: userScope.userId,
        legacyUserId: userScope.legacyUserId,
        originalName: safeFilename,
        resumeHashId,
        isActive: true,
        version: nextVersion,
      },
    });

    // ── Step 6: Enqueue async parsing job ────────────────────────────────
    await queueService.addResumeParsingJob({
      userId,
      storageKey,
      originalFilename: safeFilename,
      mimeType,
      fileHash: hash,
    });

    logger.info('[ResumeUpload] Upload complete', {
      userId,
      userResumeId: userResume.id,
      deduplicated,
      version: nextVersion,
    });

    // ── Step 7: Record RESUME_UPDATE action (Prompt 13) ──────────────────
    try {
      await actionService.recordAction({
        userId,
        actionType: ACTION_TYPES.RESUME_UPDATE,
        strategyTags: [buildResumeVersionTag(nextVersion)],
        context: {
          userResumeId: userResume.id,
          version: nextVersion,
          deduplicated,
        },
        sourceType: SOURCE_TYPES.SYSTEM_TRACKED,
        occurredAt: now,
      });
    } catch (error) {
      logger.warn('[ResumeUpload] Failed to record RESUME_UPDATE action', {
        userId,
        userResumeId: userResume.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return {
      userResumeId: userResume.id,
      resumeHashId,
      storageKey,
      presignedUrl,
      deduplicated,
      fileSizeBytes: fileBuffer.length,
      hash,
      version: nextVersion,
    };
  }

  /**
   * Returns the active resume for a user, or null if none exists.
   */
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

    if (!record) return null;

    const presignedUrl = await this.storage.getPresignedUrl(record.resumeHash.storageKey);

    return {
      userResumeId: record.id,
      originalName: record.originalName,
      presignedUrl,
      hash: record.resumeHash.hash,
      fileSizeBytes: record.resumeHash.sizeBytes,
      createdAt: record.createdAt,
      version: record.version,
    };
  }

  /**
   * Returns the active resume row for linking to applications.
   * Returns `null` when user has no resume — in that case the application
   * should still be created (it just won't have a resume link yet).
   */
  async getActiveResumeRow(userId: string): Promise<ActiveResumeRow | null> {
    const record = await prisma.userResume.findFirst({
      where: { ...userOwnershipFilter(userId), isActive: true },
      include: { resumeHash: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return null;
    return {
      userResumeId: record.id,
      storageKey: record.resumeHash.storageKey,
      originalName: record.originalName,
      mimeType: record.resumeHash.mimeType,
      fileSizeBytes: record.resumeHash.sizeBytes,
      hash: record.resumeHash.hash,
      version: record.version,
    };
  }

  /**
   * List all resume versions for a user (oldest to newest) with aggregate
   * application counts so the UI can warn before deleting a used version.
   */
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
      originalName: r.originalName,
      supersededAt: r.supersededAt,
      createdAt: r.createdAt,
      storageKey: r.resumeHash.storageKey,
      fileSizeBytes: r.resumeHash.sizeBytes,
      hash: r.resumeHash.hash,
      applicationCount: r._count.applicationLinks,
    }));
  }

  /**
   * Delete a specific resume version if it is NOT referenced by any
   * application.  Throws ValidationError if the version is in use.
   */
  async deleteVersion(userId: string, userResumeId: string): Promise<void> {
    const ownershipFilter = userOwnershipFilter(userId);
    const row = await prisma.userResume.findFirst({
      where: { id: userResumeId, ...ownershipFilter },
      include: { _count: { select: { applicationLinks: true } } },
    });
    if (!row) return; // idempotent: missing is success
    if (row._count.applicationLinks > 0) {
      throw new ValidationError(
        `Cannot delete resume version ${row.version} — it is linked to ${row._count.applicationLinks} application(s).`,
      );
    }
    await prisma.userResume.delete({ where: { id: row.id } });
    logger.info('[ResumeUpload] Resume version deleted', {
      userId,
      userResumeId,
      version: row.version,
    });
  }

  /**
   * Persist an immutable row in application_resumes linking a specific
   * resume version to a specific application.  The snapshot storage key is
   * copied from the resume hash row so the content reference survives any
   * later update to the resume version record itself.
   *
   * Uses Prisma `upsert` keyed on application_id so re-running the link
   * is idempotent (e.g. during retry of application ingestion).
   */
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
      where: { applicationId },
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

  /**
   * Returns the resume metadata linked to a given application (or null if
   * no linkage exists yet).  Used by the application detail API to show
   * "which resume was used for this application".
   */
  async getApplicationResume(applicationId: string): Promise<{
    userResumeId: string;
    version: number;
    originalName: string;
    snapshotKey: string;
    appliedAt: Date;
    usageContext?: unknown;
    fileSizeBytes?: number;
  } | null> {
    const row = await prisma.applicationResume.findUnique({
      where: { applicationId },
      include: { resumeVersion: { include: { resumeHash: true } } },
    });
    if (!row) return null;
    return {
      userResumeId: row.resumeVersion.id,
      version: row.resumeVersion.version,
      originalName: row.resumeVersion.originalName,
      snapshotKey: row.snapshotKey,
      appliedAt: row.appliedAt,
      usageContext: row.usageContext,
      fileSizeBytes: row.resumeVersion.resumeHash.sizeBytes,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

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

// Singleton
export const resumeUploadService = new ResumeUploadService();
