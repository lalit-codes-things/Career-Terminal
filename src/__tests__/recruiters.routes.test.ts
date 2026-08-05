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

// Fixed UUIDs
const REC_ID = '00000000-0000-0000-0000-000000000007';
const COMPANY_ID = '00000000-0000-0000-0000-000000000008';
const USER_ID = '00000000-0000-0000-0000-000000000002';

describe('Recruiters routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists recruiters for the authenticated user', async () => {
    mockedRecruiterService.listRecruiters.mockResolvedValue([
      {
        id: REC_ID,
        companyId: COMPANY_ID,
        company: { id: COMPANY_ID, name: 'example-organization', domain: 'example-organization.com' },
        name: 'Maya Chen',
        email: 'maya@stripe.com',
        title: 'Recruiter',
        createdAt: '2026-01-01T00:00:00.000Z',
        applicationCount: 3,
        totalEmails: 5,
        lastContactAt: '2026-01-03T00:00:00.000Z',
      },
    ]);

    const response = await request(app).get('/recruiters?company=example-organization').set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedRecruiterService.listRecruiters).toHaveBeenCalledWith(
      USER_ID,
      {
        company: 'example-organization',
        name: undefined,
      },
      {
        page: undefined,
        pageSize: undefined,
      },
    );
  });

  it('returns recruiter details', async () => {
    mockedRecruiterService.getRecruiter.mockResolvedValue({
      recruiter: {
        id: REC_ID,
        companyId: COMPANY_ID,
        company: { id: COMPANY_ID, name: 'example-organization', domain: 'example-organization.com' },
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

    const response = await request(app).get(`/recruiters/${REC_ID}`).set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.recruiter.id).toBe(REC_ID);
    expect(mockedRecruiterService.getRecruiter).toHaveBeenCalledWith(USER_ID, REC_ID);
  });

  it('returns recruiter insights', async () => {
    mockedRecruiterService.getRecruiterInsights.mockResolvedValue({
      recruiter: {
        id: REC_ID,
        companyId: COMPANY_ID,
        company: { id: COMPANY_ID, name: 'example-organization', domain: 'example-organization.com' },
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

    const response = await request(app)
      .get(`/recruiters/${REC_ID}/insights`)
      .set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totalEmails).toBe(2);
    expect(mockedRecruiterService.getRecruiterInsights).toHaveBeenCalledWith(USER_ID, REC_ID);
  });
});
