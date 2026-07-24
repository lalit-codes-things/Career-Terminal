import express from 'express';
import request from 'supertest';
import { applicationsRouter } from '../routes/applications.routes';
import { timelineRouter } from '../routes/timeline.routes';
import { errorHandler } from '../middleware/error-handler';
import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { recruiterService } from '../services/recruiter';

jest.mock('../services/application-tracking/application-tracking.service', () => ({
  applicationTrackingService: {
    listApplications: jest.fn(),
    getApplication: jest.fn(),
    getApplicationTimeline: jest.fn(),
    getApplicationStatusHistory: jest.fn(),
    updateApplicationStatus: jest.fn(),
    updateTimelineEvent: jest.fn(),
  },
}));

jest.mock('../services/recruiter', () => ({
  recruiterService: {
    getRecruiterByApplication: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/applications', applicationsRouter);
app.use('/timeline', timelineRouter);
app.use(errorHandler);

const mockedService = applicationTrackingService as unknown as {
  listApplications: jest.Mock;
  getApplication: jest.Mock;
  getApplicationTimeline: jest.Mock;
  getApplicationStatusHistory: jest.Mock;
  updateApplicationStatus: jest.Mock;
  updateTimelineEvent: jest.Mock;
};

const mockedRecruiterService = recruiterService as unknown as {
  getRecruiterByApplication: jest.Mock;
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
    expect(mockedService.listApplications).toHaveBeenCalledWith(
      'user-1',
      {
        status: 'APPLIED',
        company: 'Stripe',
        role: 'Engineer',
        date: undefined,
      },
      {
        page: undefined,
        pageSize: undefined,
      },
    );
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
      timeline: [
        {
          id: 'evt-1',
          eventType: 'STATUS_CHANGED',
          description: 'Application saved',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const response = await request(app).get('/applications/app-1').set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.application.id).toBe('app-1');
    expect(response.body.data.emailHistory).toHaveLength(1);
    expect(response.body.data.timeline).toHaveLength(1);
  });

  it('returns a chronological application timeline', async () => {
    mockedService.getApplicationTimeline.mockResolvedValue([
      {
        id: 'evt-1',
        applicationId: 'app-1',
        eventType: 'APPLICATION_SUBMITTED',
        timestamp: '2026-01-01T00:00:00.000Z',
        sourceEmailId: 'email-1',
        metadata: { subject: 'Application received' },
        description: 'APPLICATION SUBMITTED from Application received',
      },
      {
        id: 'evt-2',
        applicationId: 'app-1',
        eventType: 'INTERVIEW',
        timestamp: '2026-01-02T00:00:00.000Z',
        sourceEmailId: 'email-2',
        metadata: { subject: 'Interview scheduled' },
        description: 'INTERVIEW from Interview scheduled',
      },
    ]);

    const response = await request(app)
      .get('/applications/app-1/timeline')
      .set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(mockedService.getApplicationTimeline).toHaveBeenCalledWith('user-1', 'app-1', {
      page: undefined,
      pageSize: undefined,
    });
  });

  it('returns status history for an application', async () => {
    mockedService.getApplicationStatusHistory.mockResolvedValue([
      {
        id: 'hist-1',
        applicationId: 'app-1',
        previousStatus: null,
        status: 'APPLIED',
        source: 'EMAIL',
        sourceEmailId: 'email-1',
        changedByUserId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const response = await request(app)
      .get('/applications/app-1/status-history')
      .set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedService.getApplicationStatusHistory).toHaveBeenCalledWith('user-1', 'app-1', {
      page: undefined,
      pageSize: undefined,
    });
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
    expect(mockedService.updateApplicationStatus).toHaveBeenCalledWith(
      'user-1',
      'app-1',
      'INTERVIEW',
      'user-1',
    );
  });

  it('patches a timeline event', async () => {
    mockedService.updateTimelineEvent.mockResolvedValue({
      id: 'evt-2',
      applicationId: 'app-1',
      eventType: 'INTERVIEW',
      timestamp: '2026-01-02T00:00:00.000Z',
      sourceEmailId: 'email-2',
      metadata: { note: 'Updated' },
      description: 'INTERVIEW from Interview scheduled',
    });

    const response = await request(app)
      .patch('/timeline/evt-2')
      .set('x-user-id', 'user-1')
      .send({ metadata: { note: 'Updated' } });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe('evt-2');
    expect(mockedService.updateTimelineEvent).toHaveBeenCalledWith('user-1', 'evt-2', {
      eventType: undefined,
      timestamp: undefined,
      sourceEmailId: undefined,
      metadata: { note: 'Updated' },
      description: undefined,
    });
  });

  it('returns recruiter details for an application', async () => {
    mockedRecruiterService.getRecruiterByApplication.mockResolvedValue({
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

    const response = await request(app)
      .get('/applications/app-1/recruiter')
      .set('x-user-id', 'user-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.recruiter.id).toBe('rec-1');
    expect(mockedRecruiterService.getRecruiterByApplication).toHaveBeenCalledWith(
      'user-1',
      'app-1',
    );
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
