import express from 'express';
import request from 'supertest';
import { dashboardRouter } from '../routes/dashboard.routes';
import { dashboardService } from '../services/dashboard';
import { errorHandler } from '../middleware/error-handler';

jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user-id' };
    next();
  },
}));

jest.mock('../services/dashboard', () => ({
  dashboardService: {
    getDashboard: jest.fn(),
    getActivity: jest.fn(),
    getUpcomingInterviews: jest.fn(),
    invalidateUser: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/dashboard', dashboardRouter);
app.use(errorHandler);

const mockedService = dashboardService as unknown as {
  getDashboard: jest.Mock;
  getActivity: jest.Mock;
  getUpcomingInterviews: jest.Mock;
};

describe('Dashboard routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /dashboard returns summary metrics', async () => {
    const summary = {
      totalApplications: 10,
      activeApplications: 7,
      interviews: 2,
      offers: 1,
      rejections: 2,
      pendingAssessments: 3,
      responseRate: 0.7,
    };

    mockedService.getDashboard.mockResolvedValueOnce(summary);

    const response = await request(app).get('/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: summary,
    });
    expect(mockedService.getDashboard).toHaveBeenCalledWith('test-user-id');
  });

  it('GET /dashboard/activity returns recent events', async () => {
    const activity = [
      {
        id: 'evt-1',
        applicationId: 'app-1',
        companyName: 'example-organization',
        roleTitle: 'Engineer',
        eventType: 'INTERVIEW',
        timestamp: '2026-07-16T10:00:00.000Z',
        sourceEmailId: 'email-1',
        description: 'Interview scheduled',
        metadata: null,
      },
    ];

    mockedService.getActivity.mockResolvedValueOnce(activity);

    const response = await request(app).get('/dashboard/activity');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(mockedService.getActivity).toHaveBeenCalledWith('test-user-id', {
      page: undefined,
      pageSize: undefined,
    });
  });

  it('GET /dashboard/upcoming returns upcoming interviews', async () => {
    const upcoming = [
      {
        id: 'evt-2',
        applicationId: 'app-2',
        companyName: 'Meta',
        roleTitle: 'Product Manager',
        eventType: 'FINAL_INTERVIEW',
        timestamp: '2026-07-20T10:00:00.000Z',
        sourceEmailId: null,
        description: 'Final round',
        metadata: null,
      },
    ];

    mockedService.getUpcomingInterviews.mockResolvedValueOnce(upcoming);

    const response = await request(app).get('/dashboard/upcoming');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(mockedService.getUpcomingInterviews).toHaveBeenCalledWith('test-user-id', {
      page: undefined,
      pageSize: undefined,
    });
  });
});
