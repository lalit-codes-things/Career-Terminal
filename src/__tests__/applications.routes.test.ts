import express from 'express';
import request from 'supertest';
import { applicationsRouter } from '../routes/applications.routes';
import { errorHandler } from '../middleware/error-handler';
import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';

jest.mock('../services/application-tracking/application-tracking.service', () => ({
  applicationTrackingService: {
    listApplications: jest.fn(),
    getApplication: jest.fn(),
    updateApplicationStatus: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/applications', applicationsRouter);
app.use(errorHandler);

const mockedService = applicationTrackingService as unknown as {
  listApplications: jest.Mock;
  getApplication: jest.Mock;
  updateApplicationStatus: jest.Mock;
};

describe('Applications routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists applications with filters', async () => {
    mockedService.listApplications.mockResolvedValue([
      {
        id: 'app-1',
        userId: 'user-1',
        company: { name: 'Stripe', domain: 'stripe.com' },
        role: { title: 'Engineer', department: 'Engineering' },
        status: 'APPLIED',
        appliedDate: '2026-01-01T00:00:00.000Z',
        recruiter: { name: 'Maya', email: 'maya@stripe.com' },
        sourceEmailId: 'email-1',
      },
    ]);

    const response = await request(app)
      .get('/applications?status=APPLIED&company=Stripe&role=Engineer')
      .set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedService.listApplications).toHaveBeenCalledWith('user-1', {
      status: 'APPLIED',
      company: 'Stripe',
      role: 'Engineer',
      date: undefined,
    });
  });

  it('returns application details with email history and timeline', async () => {
    mockedService.getApplication.mockResolvedValue({
      application: {
        id: 'app-1',
        userId: 'user-1',
        company: { name: 'Stripe', domain: 'stripe.com' },
        role: { title: 'Engineer', department: 'Engineering' },
        status: 'APPLIED',
        appliedDate: '2026-01-01T00:00:00.000Z',
        recruiter: { name: 'Maya', email: 'maya@stripe.com' },
        sourceEmailId: 'email-1',
      },
      emailHistory: [{ id: 'email-1', subject: 'Application received' }],
      timeline: [{ id: 'evt-1', eventType: 'STATUS_CHANGED', description: 'Application saved', timestamp: '2026-01-01T00:00:00.000Z' }],
    });

    const response = await request(app).get('/applications/app-1').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.application.id).toBe('app-1');
    expect(response.body.data.emailHistory).toHaveLength(1);
    expect(response.body.data.timeline).toHaveLength(1);
  });

  it('updates application status and creates a timeline event', async () => {
    mockedService.updateApplicationStatus.mockResolvedValue({
      application: {
        id: 'app-1',
        userId: 'user-1',
        company: { name: 'Stripe', domain: 'stripe.com' },
        role: { title: 'Engineer', department: 'Engineering' },
        status: 'INTERVIEW',
        appliedDate: '2026-01-01T00:00:00.000Z',
        recruiter: { name: 'Maya', email: 'maya@stripe.com' },
        sourceEmailId: 'email-1',
      },
      timelineEvent: {
        id: 'evt-2',
        eventType: 'STATUS_CHANGED',
        description: 'Application status updated to INTERVIEW',
        timestamp: '2026-01-02T00:00:00.000Z',
      },
    });

    const response = await request(app)
      .patch('/applications/app-1/status')
      .set('x-user-id', 'user-1')
      .send({ status: 'INTERVIEW' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.application.status).toBe('INTERVIEW');
    expect(response.body.data.timelineEvent.description).toContain('INTERVIEW');
  });

  it('rejects invalid statuses', async () => {
    const response = await request(app)
      .patch('/applications/app-1/status')
      .set('x-user-id', 'user-1')
      .send({ status: 'Pending' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
