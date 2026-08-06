/**
 * Resume routes.
 *
 * POST /resume/upload   — Upload a resume with SHA-256 deduplication.
 * GET  /resume/active   — Retrieve the user's current active resume.
 * POST /resume/match    — Score a resume against a job description (existing).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { ValidationError } from '../errors/app-errors';
import { resumeMatcherService } from '../services/resume-matcher/resume-matcher.service';
import { resumeUploadService } from '../services/resume/resume-upload.service';
import { uploadLimiter, expensiveLimiter } from '../middleware/rate-limiter';
import {
  sanitizeFilename,
  ALLOWED_DOCUMENT_MIME_TYPES,
  assertFileSignature,
} from '../infrastructure/security/utils';
import { parseSizeToBytes } from '../lib/size';
import { config } from '../config';
import { planner } from '../services/planner';
import { documentExtractionService } from '../services/document/document-extraction.service';

const MAX_MULTIPART_SIZE_BYTES = parseSizeToBytes(config.limits.maxMultipartSize);

const ALLOWED_RESUME_MIME_TYPES = ALLOWED_DOCUMENT_MIME_TYPES;

const MAX_JOB_DESCRIPTION_LENGTH = 50_000;

/** Shared inline-parse guard: MIME allowlist + magic-byte (anti-spoofing). */
function assertValidResumeFile(file: Express.Multer.File): void {
  if (!ALLOWED_RESUME_MIME_TYPES.has(file.mimetype)) {
    throw new ValidationError(
      `File type '${file.mimetype}' is not allowed. Supported types: PDF, DOC, DOCX`,
    );
  }
  const ext = path.extname(file.originalname).toLowerCase();
  assertFileSignature(fs.readFileSync(file.path), file.mimetype, ext);
}

const tmpDir = path.join(os.tmpdir(), 'career-terminal-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_MULTIPART_SIZE_BYTES },
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
          `File type '${file.mimetype}' is not allowed. Supported types: PDF, DOC, DOCX`,
        );
      }

      // Filename sanitization
      const safeFilename = sanitizeFilename(file.originalname);
      const fileBuffer = fs.readFileSync(file.path);
      fs.unlinkSync(file.path);

      const result = await resumeUploadService.upload({
        userId,
        fileBuffer,
        originalFilename: safeFilename,
        mimeType: file.mimetype,
      });

      res.status(202).json({
        success: true,
        data: {
          userResumeId: result.userResumeId,
          storageKey: result.storageKey,
          presignedUrl: result.presignedUrl,
          fileSizeBytes: result.fileSizeBytes,
          hash: result.hash,
          deduplicated: result.deduplicated,
          scanningStatus: result.scanningStatus,
          status: result.status,
          message: 'File uploaded successfully. Malware scan queued.',
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

       assertValidResumeFile(file);

       const fileBuffer = fs.readFileSync(file.path);
       fs.unlinkSync(file.path);

       const { rawText: resumeText } = await documentExtractionService.extract(
         fileBuffer,
         file.mimetype,
       );
      const matchScore = await resumeMatcherService.scoreMatch(resumeText, jobDescription);

      res.json({ success: true, data: matchScore });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /resume/versions
// ---------------------------------------------------------------------------

resumeRouter.get(
  '/versions',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const versions = await resumeUploadService.listVersions(userId);
      res.json({ success: true, data: versions });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /resume/versions/:id
// ---------------------------------------------------------------------------

resumeRouter.delete(
  '/versions/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const userResumeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!userResumeId) {
        throw new ValidationError('Resume version id is required.');
      }
      await resumeUploadService.deleteVersion(userId, userResumeId);
      res.json({ success: true, message: 'Resume version deleted.' });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /resume/analyze
// AI-powered resume analysis via planner → extract + infer capabilities.
// Persists findings as FactObservation rows via the capability base.
// ---------------------------------------------------------------------------

resumeRouter.post(
  '/analyze',
  expensiveLimiter,
  requireAuth,
  upload.single('resume'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const file = req.file;
      const userResumeId = req.body.userResumeId as string | undefined;

      if (!file && !userResumeId) {
        throw new ValidationError('Either a resume file or userResumeId is required');
      }

      let resumeText = '';
      let entityId = userResumeId ?? 'unknown';

      if (file) {
        assertValidResumeFile(file);
        const fileBuffer = fs.readFileSync(file.path);
        fs.unlinkSync(file.path);
        const { rawText } = await documentExtractionService.extract(fileBuffer, file.mimetype);
        resumeText = rawText;
        entityId = userResumeId ?? `resume-${Date.now()}`;
      }

      const result = await planner.run({
        userId,
        entityId,
        entityType: 'resume',
        content: resumeText,
        intent: 'extract',
        context: { userResumeId: entityId },
      });

      res.json({
        success: true,
        data: {
          planId: result.planId,
          capabilitiesRun: result.capabilitiesRun,
          fields: result.results.flatMap((r) => r.fields),
          confidence: result.results.length
            ? result.results.reduce((s, r) => s + r.confidence, 0) / result.results.length
            : 0,
          latencyMs: result.totalLatencyMs,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
