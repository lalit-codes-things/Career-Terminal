import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { ValidationError } from '../errors/app-errors';
import { queueService } from '../services/queue/queue.service';
import { s3Service } from '../infrastructure/storage/s3.service';
import { uploadLimiter } from '../middleware/rate-limiter';
import { sanitizeFilename, ALLOWED_DOCUMENT_MIME_TYPES } from '../infrastructure/security/utils';
import { parseSizeToBytes } from '../lib/size';
import { config } from '../config';
import { dbRouter } from '../config/database';
import { userOwnershipFilter } from '../utils/user-ownership';
import { interviewMemoryService } from '../services/interview/interview-memory.service';

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
      const userId = req.user!.id;
      const file = req.file;

      if (!file) {
        throw new ValidationError('Transcript file is required (field name: "transcript")');
      }

      const sourceType = 'TRANSCRIPT_UPLOAD';
      const companyNameRaw = (req.body.companyNameRaw as string) ?? null;
      const canonicalCompanyId = (req.body.canonicalCompanyId as string) ?? null;
      const roleTitle = (req.body.roleTitle as string) ?? 'Unknown Role';
      const loopType = (req.body.loopType as string) ?? 'STANDARD';

      const fileBuffer = fs.readFileSync(file.path);
      fs.unlinkSync(file.path);

      const s3Key = s3Service.generateKey('interview-sessions', file.originalname);
      const s3Result = await s3Service.upload(fileBuffer, s3Key, file.mimetype);

      const session = await dbRouter.write().interviewSession.create({
        data: {
          userId,
          companyNameRaw,
          canonicalCompanyId: canonicalCompanyId ?? undefined,
          roleTitle,
          jobLevel: 'unknown',
          loopType,
          sourceType,
          status: 'IN_PROGRESS',
          shareForGlobalIntelligence: false,
          confidence: 0.5,
          s3Key: s3Result.key,
          rawTranscript: fileBuffer.toString('utf-8'),
          isCurrent: true,
        },
      });

      const deterministicId = `interview:${userId}:${session.id}`;

      await queueService.addInterviewSessionJob({
        type: 'EXTRACT_INTERVIEW_SESSION',
        userId,
        sessionId: session.id,
        sourceType,
        s3Key: s3Result.key,
        mimeType: file.mimetype,
        originalFilename: sanitizeFilename(file.originalname),
        content: fileBuffer.toString('utf-8'),
        ...(canonicalCompanyId ? { canonicalCompanyId } : {}),
        ...(companyNameRaw ? { companyNameRaw } : {}),
        roleTitle,
        loopType,
        metadata: {
          fileSizeBytes: file.size,
          s3ETag: s3Result.etag,
        },
      }, { jobId: deterministicId });

      res.status(202).json({
        success: true,
        data: {
          sessionId: session.id,
          jobId: deterministicId,
          status: 'queued',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

interviewRouter.post(
  '/sessions/manual',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const {
        companyNameRaw,
        canonicalCompanyId,
        roleTitle,
        loopType,
        rounds,
      } = req.body;

      const session = await dbRouter.write().interviewSession.create({
        data: {
          userId,
          companyNameRaw: companyNameRaw ?? null,
          canonicalCompanyId: canonicalCompanyId ?? undefined,
          roleTitle: roleTitle ?? 'Unknown Role',
          jobLevel: 'unknown',
          loopType: loopType ?? 'STANDARD',
          sourceType: 'MANUAL_ENTRY',
          status: 'SCHEDULED',
          shareForGlobalIntelligence: false,
          confidence: 0.5,
          isCurrent: true,
        },
      });

      if (Array.isArray(rounds)) {
        for (const round of rounds) {
          await dbRouter.write().interviewRound.create({
            data: {
              sessionId: session.id,
              userId,
              roundType: round.roundType ?? 'SCREENING',
              sequenceNumber: round.sequenceNumber ?? 0,
              notes: round.notes ?? null,
              outcomeLabel: round.outcomeLabel ?? null,
              confidence: 0.5,
            },
          });
        }
      }

      res.status(201).json({
        success: true,
        data: session,
      });
    } catch (error) {
      next(error);
    }
  },
);

interviewRouter.get(
  '/sessions',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { status, canonicalCompanyId, page = '1', limit = '20' } = req.query;

      const where: Record<string, unknown> = {
        ...userOwnershipFilter(userId),
      };

      if (status && typeof status === 'string') {
        where.status = status;
      }

      if (canonicalCompanyId && typeof canonicalCompanyId === 'string') {
        where.canonicalCompanyId = canonicalCompanyId;
      }

      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip = (pageNum - 1) * limitNum;

      const [sessions, total] = await Promise.all([
        dbRouter.read().interviewSession.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { createdAt: 'desc' },
        }),
        dbRouter.read().interviewSession.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        data: {
          sessions,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

interviewRouter.get(
  '/sessions/:sessionId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { sessionId } = req.params;

      const session = await dbRouter.read().interviewSession.findFirst({
        where: {
          id: sessionId,
          ...userOwnershipFilter(userId),
        },
        include: {
          rounds: {
            orderBy: { sequenceNumber: 'asc' },
            include: {
              events: true,
              signals: true,
              competencyObservations: {
                include: {
                  competency: true,
                },
              },
            },
          },
          events: true,
          signals: true,
          competencyObservations: {
            include: {
              competency: true,
            },
          },
        },
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Interview session not found',
        });
      }

      res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error) {
      next(error);
    }
  },
);

interviewRouter.patch(
  '/sessions/:sessionId/consent',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { sessionId } = req.params;
      const { shareForGlobalIntelligence } = req.body as { shareForGlobalIntelligence: boolean };

      if (typeof shareForGlobalIntelligence !== 'boolean') {
        throw new ValidationError('shareForGlobalIntelligence must be a boolean');
      }

      const session = await dbRouter.write().interviewSession.findFirst({
        where: {
          id: sessionId,
          ...userOwnershipFilter(userId),
        },
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Interview session not found',
        });
      }

      const updated = await dbRouter.write().interviewSession.update({
        where: { id: sessionId },
        data: {
          shareForGlobalIntelligence,
          updatedAt: new Date(),
        },
      });

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  },
);

interviewRouter.get(
  '/memory',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const memory = await interviewMemoryService.getInterviewMemory(userId);
      res.status(200).json({
        success: true,
        data: memory,
      });
    } catch (error) {
      next(error);
    }
  },
);
