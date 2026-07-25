/**
 * Resume routes.
 *
 * POST /resume/upload   — Upload a resume with SHA-256 deduplication.
 * GET  /resume/active   — Retrieve the user's current active resume.
 * POST /resume/match    — Score a resume against a job description (existing).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { ValidationError } from '../errors/app-errors';
import { resumeMatcherService } from '../services/resume-matcher/resume-matcher.service';
import { resumeUploadService } from '../services/resume/resume-upload.service';
import { uploadLimiter, expensiveLimiter } from '../middleware/rate-limiter';
import { sanitizeFilename } from '../infrastructure/security/utils';

// Allowed MIME types for resume uploads
const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const MAX_JOB_DESCRIPTION_LENGTH = 50_000;

// multer: keep file in memory so we can hash it before deciding whether to upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard limit at the HTTP layer
});

export const resumeRouter = Router();

// ---------------------------------------------------------------------------
// POST /resume/upload
// ---------------------------------------------------------------------------

resumeRouter.post(
  '/upload',
  uploadLimiter,
  requireAuth,
  upload.single('resume'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const file = req.file;

      if (!file) {
        throw new ValidationError('Resume file is required (field name: "resume")');
      }

      // MIME type validation
      if (!ALLOWED_RESUME_MIME_TYPES.has(file.mimetype)) {
        throw new ValidationError(
          `File type '${file.mimetype}' is not allowed. Supported types: PDF, DOC, DOCX, TXT`,
        );
      }

      // Filename sanitization
      const safeFilename = sanitizeFilename(file.originalname);

      const result = await resumeUploadService.upload({
        userId,
        fileBuffer: file.buffer,
        originalFilename: safeFilename,
        mimeType: file.mimetype,
      });

      res.status(201).json({
        success: true,
        data: {
          userResumeId: result.userResumeId,
          storageKey: result.storageKey,
          presignedUrl: result.presignedUrl,
          fileSizeBytes: result.fileSizeBytes,
          hash: result.hash,
          deduplicated: result.deduplicated,
          message: result.deduplicated
            ? 'Identical file already stored — linked to existing blob (no re-upload).'
            : 'File uploaded successfully. Parsing job queued.',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /resume/active
// ---------------------------------------------------------------------------

resumeRouter.get(
  '/active',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const resume = await resumeUploadService.getActiveResume(userId);

      if (!resume) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No active resume found for this user' },
        });
        return;
      }

      res.json({ success: true, data: resume });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /resume/match  (existing — unchanged)
// ---------------------------------------------------------------------------

resumeRouter.post(
  '/match',
  expensiveLimiter,
  requireAuth,
  upload.single('resume'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      const jobDescription = req.body.jobDescription;

      if (!file) {
        throw new ValidationError('Resume file is required');
      }
      if (!jobDescription || typeof jobDescription !== 'string') {
        throw new ValidationError('Job description text is required');
      }
      if (jobDescription.length > MAX_JOB_DESCRIPTION_LENGTH) {
        throw new ValidationError(
          `Job description must not exceed ${MAX_JOB_DESCRIPTION_LENGTH} characters`,
        );
      }

      const resumeText = await resumeMatcherService.extractTextFromBuffer(
        file.buffer,
        file.mimetype,
      );
      const matchScore = await resumeMatcherService.scoreMatch(resumeText, jobDescription);

      res.json({ success: true, data: matchScore });
    } catch (error) {
      next(error);
    }
  },
);
