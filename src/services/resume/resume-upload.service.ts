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
import { prisma } from '../../config/database';
import type { IStorageService } from '../storage/storage.service';
import { storageService as defaultStorageService } from '../storage/storage.service';
import { queueService } from '../queue/queue.service';
import { ValidationError } from '../../errors/app-errors';
import { logger } from '../../lib/logger';
import { sanitizeFilename } from '../../infrastructure/security/utils';

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
}

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

    // ── Step 4: Deactivate previous active resumes for this user ──────────
    await prisma.userResume.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    // ── Step 5: Create user_resumes record ───────────────────────────────
    const userResume = await prisma.userResume.create({
      data: {
        userId,
        originalName: safeFilename,
        resumeHashId,
        isActive: true,
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
    });

    return {
      userResumeId: userResume.id,
      resumeHashId,
      storageKey,
      presignedUrl,
      deduplicated,
      fileSizeBytes: fileBuffer.length,
      hash,
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
  } | null> {
    const record = await prisma.userResume.findFirst({
      where: { userId, isActive: true },
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
