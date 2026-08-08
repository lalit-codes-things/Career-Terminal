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
import { ALLOWED_DOCUMENT_MIME_TYPES } from '../infrastructure/security/utils';
import { parseSizeToBytes } from '../lib/size';
import { config } from '../config';

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

export const interviewRouter = Router();

interviewRouter.post(
  '/sessions/upload',
  uploadLimiter,
  requireAuth,
  upload.single('transcript'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;

      if (!file) {
        throw new ValidationError('Transcript file is required (field name: "transcript")');
      }

      const fileBuffer = fs.readFileSync(file.path);
      fs.unlinkSync(file.path);

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
