import request from 'supertest';
import express from 'express';
import { analyticsRouter } from '../routes/analytics.routes';
import { analyticsService } from '../services/analytics.service';

const app = express();
app.use(express.json());

jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user-id' };
    next();
  },
}));

jest.mock('../services/analytics.service', () => ({
  analyticsService: {
    getOverallFunnel: jest.fn(),
  },
}));

app.use('/analytics', analyticsRouter);

describe('Analytics Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /analytics/jobs should return analytics data', async () => {
    const mockAnalytics = {
      applications: 10,
      responses: 5,
      interviews: 2,
      offers: 1,
      conversionRates: {
        responseRate: 0.5,
        interviewRate: 0.2,
        offerRate: 0.1,
      },
      averageResponseTimeDays: 5,
      companiesAppliedTo: 8,
      mostSuccessfulJobCategories: [
        { category: 'Engineering', applications: 5, interviews: 2, interviewRate: 0.4 },
      ],
    };

    (analyticsService.getOverallFunnel as jest.Mock).mockResolvedValueOnce(mockAnalytics);

    const response = await request(app).get('/analytics/jobs');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: mockAnalytics,
    });
    expect(analyticsService.getOverallFunnel).toHaveBeenCalledWith('test-user-id');
  });

  it('GET /analytics/jobs should handle errors', async () => {
    (analyticsService.getOverallFunnel as jest.Mock).mockRejectedValueOnce(
      new Error('Database error'),
    );

    const errorApp = express();
    errorApp.use(express.json());
    errorApp.use((req: any, _res: any, next: any) => {
      req.user = { id: 'test-user-id' };
      next();
    });
    errorApp.use('/analytics', analyticsRouter);
    errorApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ success: false, error: err.message });
    });

    const response = await request(errorApp).get('/analytics/jobs');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Database error',
    });
  });
});