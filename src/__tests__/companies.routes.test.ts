import express from 'express';
import request from 'supertest';
import { companiesRouter } from '../routes/companies.routes';
import { errorHandler } from '../middleware/error-handler';
import { companyService } from '../services/company';

jest.mock('../services/company', () => ({
  companyService: {
    listCompanies: jest.fn(),
    getCompany: jest.fn(),
    getCompanyApplications: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/companies', companiesRouter);
app.use(errorHandler);

const mockedCompanyService = companyService as unknown as {
  listCompanies: jest.Mock;
  getCompany: jest.Mock;
  getCompanyApplications: jest.Mock;
};

describe('Companies routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists companies for the authenticated user', async () => {
    mockedCompanyService.listCompanies.mockResolvedValue([
      {
        id: 'company-1',
        name: 'Google',
        domain: 'google.com',
        careersUrl: null,
        website: null,
        logoUrl: null,
        industry: 'Tech',
        headquarters: 'Mountain View',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        applicationCount: 1,
        recruiterCount: 1,
        lastApplicationAt: '2026-01-05T00:00:00.000Z',
      },
    ]);

    const response = await request(app).get('/companies?name=Google').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedCompanyService.listCompanies).toHaveBeenCalledWith('user-1', {
      name: 'Google',
      domain: undefined,
      industry: undefined,
    });
  });

  it('returns company details', async () => {
    mockedCompanyService.getCompany.mockResolvedValue({
      id: 'company-1',
      name: 'Google',
      domain: 'google.com',
      careersUrl: null,
      website: null,
      logoUrl: null,
      industry: 'Tech',
      headquarters: 'Mountain View',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      applicationCount: 1,
      recruiterCount: 1,
      lastApplicationAt: '2026-01-05T00:00:00.000Z',
      aliases: ['Google LLC'],
    });

    const response = await request(app).get('/companies/company-1').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.aliases).toContain('Google LLC');
    expect(mockedCompanyService.getCompany).toHaveBeenCalledWith('user-1', 'company-1');
  });

  it('returns applications for a company', async () => {
    mockedCompanyService.getCompanyApplications.mockResolvedValue([
      {
        id: 'app-1',
        userId: 'user-1',
        appliedDate: '2026-01-05T00:00:00.000Z',
        status: 'APPLIED',
        roleTitle: 'Engineer',
        companyName: 'Google',
        recruiterName: 'Maya',
        recruiterEmail: 'maya@google.com',
      },
    ]);

    const response = await request(app).get('/companies/company-1/applications').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedCompanyService.getCompanyApplications).toHaveBeenCalledWith('user-1', 'company-1');
  });
});
