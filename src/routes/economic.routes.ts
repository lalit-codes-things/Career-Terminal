import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { ValidationError } from '../errors/app-errors';
import { queueService } from '../services/queue/queue.service';
import { documentExtractionService } from '../services/document/document-extraction.service';
import { s3Service } from '../infrastructure/storage/s3.service';
import { uploadLimiter } from '../middleware/rate-limiter';
import { sanitizeFilename, ALLOWED_DOCUMENT_MIME_TYPES } from '../infrastructure/security/utils';
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

export const economicRouter = Router();

economicRouter.post(
  '/upload',
  uploadLimiter,
  requireAuth,
  upload.single('document'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const file = req.file;

      if (!file) {
        throw new ValidationError('Document file is required (field name: "document")');
      }

      const documentType = (req.body.documentType as string) ?? 'unknown';
      const documentCategory = (req.body.documentCategory as string) ?? 'general';
      const sourceName = (req.body.sourceName as string) ?? null;
      const sourceUri = (req.body.sourceUri as string) ?? null;
      const currency = (req.body.currency as string) ?? null;
      const locale = (req.body.locale as string) ?? null;
      const validFrom = (req.body.validFrom as string) ?? null;
      const validTo = (req.body.validTo as string) ?? null;
      const transactionStart = (req.body.transactionStart as string) ?? null;
      const transactionEnd = (req.body.transactionEnd as string) ?? null;

      const fileBuffer = fs.readFileSync(file.path);
      fs.unlinkSync(file.path);

      const s3Key = s3Service.generateKey('economic-documents', file.originalname);
      const s3Result = await s3Service.upload(fileBuffer, s3Key, file.mimetype);

      const extractedText = await documentExtractionService.extract(fileBuffer, file.mimetype);

      const deterministicId = `economic:${userId}:${documentType}:${s3Result.key}`;

      await queueService.addEconomicDocumentJob({
        type: 'EXTRACT_ECONOMIC_DOCUMENT',
        userId,
        documentId: deterministicId,
        documentType,
        documentCategory,
        s3Key: s3Result.key,
        mimeType: file.mimetype,
        originalFilename: sanitizeFilename(file.originalname),
        content: extractedText.rawText,
        sourceName,
        sourceUri,
        currency,
        locale,
        validFrom,
        validTo,
        transactionStart,
        transactionEnd,
        metadata: {
          fileSizeBytes: file.size,
          s3ETag: s3Result.etag,
        },
      }, { jobId: deterministicId });

      res.status(202).json({
        success: true,
        data: {
          jobId: deterministicId,
          storageKey: s3Result.key,
          presignedUrl: s3Service.getPublicUrl(s3Result.key),
          fileSizeBytes: file.size,
          documentType,
          documentCategory,
          status: 'queued',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);