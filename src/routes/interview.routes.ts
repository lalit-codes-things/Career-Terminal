import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { ValidationError } from '../errors/app-errors';
import { s3Service } from '../infrastructure/storage/s3.service';
import { uploadLimiter } from '../middleware/rate-limiter';
import { ALLOWED_DOCUMENT_MIME_TYPES, assertFileSignature } from '../infrastructure/security/utils';
import { parseSizeToBytes } from '../lib/size';
import { validateUploadedFilePath } from '../lib/upload-path';
import { config } from '../config';
import { patternMiningService } from '../services/interview/pattern-mining.service';

const MAX_MULTIPART_SIZE_BYTES = parseSizeToBytes(config.limits.maxMultipartSize);

const tmpDir = path.join(os.tmpdir(), 'career-terminal-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_MULTIPART_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`File type '${file.mimetype}' is not allowed`));
    }
  },
});

/**
 * Interview routes — transcript upload and pattern retrieval.
 *
 * POST /sessions/upload — Upload an interview transcript (user-aware rate-limited).
 * GET  /patterns       — Retrieve published interview patterns.
 */
export const interviewRouter = Router();

/**
 * POST /sessions/upload
 *
 * Uploads an interview transcript file for a user's interview session.
 * The file is validated against allowed MIME types, magic-byte signatures,
 * and stored in S3. A user-aware rate limiter enforces per-user quotas.
 *
 * Response 202: { success: true, data: { storageKey, presignedUrl, ... } }
 * Response 400: Missing file or invalid MIME type / magic bytes.
 * Response 401: Missing or invalid JWT.
 * Response 429: Rate limit exceeded.
 */
interviewRouter.post(
  '/sessions/upload',
  requireAuth,
  uploadLimiter,
  upload.single('transcript'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;

      if (!file) {
        throw new ValidationError('Transcript file is required (field name: "transcript")');
      }

      const validatedPath = validateUploadedFilePath(file.path, tmpDir);
      const fileBuffer = fs.readFileSync(validatedPath);
      const ext = path.extname(file.originalname).toLowerCase();
      assertFileSignature(fileBuffer, file.mimetype, ext);
      fs.unlinkSync(validatedPath);

      const s3Key = s3Service.generateKey('interview-sessions', file.originalname);
      const s3Result = await s3Service.upload(fileBuffer, s3Key, file.mimetype);

      res.status(202).json({
        success: true,
        data: {
          storageKey: s3Result.key,
          presignedUrl: s3Service.getPublicUrl(s3Result.key),
          fileSizeBytes: file.size,
          mimeType: file.mimetype,
          status: 'uploaded',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /patterns
 *
 * Returns published interview patterns filtered by optional company and role.
 * Only patterns that have cleared the minimum cohort threshold and are
 * marked as published are returned.
 *
 * Query: canonicalCompanyId?, roleTitle?
 * Response 200: { success: true, data: InterviewPattern[] }
 * Response 401: Missing or invalid JWT.
 */
interviewRouter.get(
  '/patterns',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { canonicalCompanyId, roleTitle } = req.query as {
        canonicalCompanyId?: string;
        roleTitle?: string;
      };

      const patterns = await patternMiningService.findPublishedPatterns({
        canonicalCompanyId: canonicalCompanyId ?? null,
        normalizedRoleTitle: roleTitle ?? null,
      });

      res.json({ success: true, data: patterns });
    } catch (error) {
      next(error);
    }
  },
);
