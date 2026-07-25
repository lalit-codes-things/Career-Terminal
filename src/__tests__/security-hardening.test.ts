import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { server } from '../index';
import { prisma } from '../config/database';
import { queueService } from '../services/queue/queue.service';
import { cacheService } from '../services/cache/cache.service';
import { jobApplicationExtractor } from '../services/job-application/job-application-extractor';
import { validateParams } from '../middleware/validate';
import { JobEmailCategory } from '../services/job-intelligence/models/job-intelligence.types';
import { errorHandler } from '../middleware/error-handler';

jest.mock('../config/database', () => ({
  prisma: {
    $disconnect: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  },
}));

describe('Security Hardening & Middleware Pipeline', () => {
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await prisma.$disconnect();
    await queueService.close();
    if ('disconnect' in cacheService) {
      await (cacheService as any).disconnect();
    }
  });

  describe('HTTP Headers & Method Tampering', () => {
    it('should not leak X-Powered-By header', async () => {
      const response = await request(server).get('/health');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should set security headers', async () => {
      const response = await request(server).get('/health');
      expect(response.headers['cross-origin-opener-policy']).toBeDefined();
      expect(response.headers['cross-origin-embedder-policy']).toBeDefined();
      expect(response.headers['cross-origin-resource-policy']).toBeDefined();
    });

    it('should reject Method Override headers', async () => {
      const response = await request(server).get('/health').set('X-HTTP-Method-Override', 'DELETE');
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('Method override is not permitted');
    });
  });

  describe('Path Parameter Validation', () => {
    const app = express();
    app.get('/test/:id', validateParams(z.object({ id: z.string().uuid() })), (req, res) => {
      res.json({ id: req.params.id });
    });
    app.use(errorHandler);

    it('should accept valid UUIDs', async () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const response = await request(app).get(`/test/${validUuid}`);
      expect(response.status).toBe(200);
    });

    it('should reject invalid UUIDs', async () => {
      const response = await request(app).get('/test/not-a-uuid');
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('Invalid request'); // Or whatever formatZodError returns if we caught it in global handler, but here we just test the middleware isolated. Wait, the middleware calls next(err), we need an error handler for isolated test.
    });
  });

  describe('ReDoS Protection (Text Truncation)', () => {
    it('should truncate extremely long text to prevent regex backtracking', () => {
      const longString = 'round 1 ' + 'A'.repeat(50000);
      const start = Date.now();

      // We test a private method indirectly via extract if possible, or just mock it.
      // We can pass a huge body text to extract
      const email = {
        emailId: 'test',
        sender: 'test@example.com',
        subject: 'Interview for Software Engineer',
        receivedAt: new Date(),
        bodyText: longString,
        bodyHtml: null,
      };

      const result = jobApplicationExtractor.extract(email, 'user-1', {
        emailId: email.emailId,
        category: JobEmailCategory.INTERVIEW_INVITATION,
        detectedCompany: 'Google',
        detectedRole: 'Software Engineer',
        confidence: 0.9,
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500); // Should be very fast due to truncation
      expect(result.hiringProcess.interviewRounds).toBe(1);
    });
  });
});
