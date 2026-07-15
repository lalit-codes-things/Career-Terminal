import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { resumeMatcherService } from '../services/resume-matcher/resume-matcher.service';
import type { Request, Response, NextFunction } from 'express';

const upload = multer({ storage: multer.memoryStorage() });
export const resumeRouter = Router();

resumeRouter.post(
  '/match',
  requireAuth,
  upload.single('resume'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      const jobDescription = req.body.jobDescription;

      if (!file) {
        throw new Error('Resume file is required');
      }
      if (!jobDescription || typeof jobDescription !== 'string') {
        throw new Error('Job description text is required');
      }

      // Extract text from the uploaded file
      const resumeText = await resumeMatcherService.extractTextFromBuffer(file.buffer, file.mimetype);

      // Score the match
      const matchScore = await resumeMatcherService.scoreMatch(resumeText, jobDescription);

      res.json({
        success: true,
        data: matchScore,
      });
    } catch (error) {
      next(error);
    }
  }
);
