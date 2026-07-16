import express from 'express';
import request from 'supertest';
import { recruitersRouter } from '../routes/recruiters.routes';
import { errorHandler } from '../middleware/error-handler';
import { recruiterService } from '../services/recruiter';

jest.mock('../services/recruiter', () => ({
  recruiterService: {
    listRecruiters: jest.fn(),
    getRecruiter: jest.fn(),
    getRecruiterInsights: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/recruiters', recruitersRouter);
app.use(errorHandler);

const mockedRecruiterService = recruiterService as unknown as {
  listRecruiters: jest.Mock;
  getRecruiter: jest.Mock;
  getRecruiterInsights: jest.Mock;
};

describe('Recruiters routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists recruiters for the authenticated user', async () => {
    mockedRecruiterService.listRecruiters.mockResolvedValue([
      {
        id: 'rec-1',
        companyId: 'company-1',
        company: { id: 'company-1', name: 'Stripe', domain: 'stripe.com' },
        name: 'Maya Chen',
        email: 'maya@stripe.com',
        title: 'Recruiter',
        createdAt: '2026-01-01T00:00:00.000Z',
        applicationCount: 3,
        totalEmails: 5,
        lastContactAt: '2026-01-03T00:00:00.000Z',
      },
    ]);

    const response = await request(app).get('/recruiters?company=Stripe').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedRecruiterService.listRecruiters).toHaveBeenCalledWith('user-1', {
      company: 'Stripe',
      name: undefined,
    });
  });

  it('returns recruiter details', async () => {
    mockedRecruiterService.getRecruiter.mockResolvedValue({
      recruiter: {
        id: 'rec-1',
        companyId: 'company-1',
        company: { id: 'company-1', name: 'Stripe', domain: 'stripe.com' },
        name: 'Maya Chen',
        email: 'maya@stripe.com',
        title: 'Recruiter',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      firstContactAt: '2026-01-01T00:00:00.000Z',
      lastContactAt: '2026-01-03T00:00:00.000Z',
      totalEmails: 2,
      averageResponseTimeMinutes: 1440,
      applicationCount: 1,
      linkedEmailConversations: [],
    });

    const response = await request(app).get('/recruiters/rec-1').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.recruiter.id).toBe('rec-1');
    expect(mockedRecruiterService.getRecruiter).toHaveBeenCalledWith('user-1', 'rec-1');
  });

  it('returns recruiter insights', async () => {
    mockedRecruiterService.getRecruiterInsights.mockResolvedValue({
      recruiter: {
        id: 'rec-1',
        companyId: 'company-1',
        company: { id: 'company-1', name: 'Stripe', domain: 'stripe.com' },
        name: 'Maya Chen',
        email: 'maya@stripe.com',
        title: 'Recruiter',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      firstContactAt: '2026-01-01T00:00:00.000Z',
      lastContactAt: '2026-01-03T00:00:00.000Z',
      totalEmails: 2,
      averageResponseTimeMinutes: 1440,
      applicationCount: 1,
      linkedEmailConversations: [],
    });

    const response = await request(app).get('/recruiters/rec-1/insights').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totalEmails).toBe(2);
    expect(mockedRecruiterService.getRecruiterInsights).toHaveBeenCalledWith('user-1', 'rec-1');
  });
});
