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

// Fixed UUIDs used across all test assertions
const APP_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const EMAIL_ID = '00000000-0000-0000-0000-000000000003';
const EVT_ID_1 = '00000000-0000-0000-0000-000000000004';
const EVT_ID_2 = '00000000-0000-0000-0000-000000000005';
const HIST_ID = '00000000-0000-0000-0000-000000000006';
const REC_ID = '00000000-0000-0000-0000-000000000007';
const COMPANY_ID = '00000000-0000-0000-0000-000000000008';

describe('Applications routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists applications with filters', async () => {
    mockedService.listApplications.mockResolvedValue([
      {
        id: APP_ID,
        userId: USER_ID,
        company: { name: 'example-organization', domain: 'example-organization.com' },
        role: { title: 'Engineer', department: 'Engineering' },
        status: 'APPLIED',
        appliedDate: '2026-01-01T00:00:00.000Z',
        recruiter: { name: 'Maya', email: 'maya@stripe.com' },
        sourceEmailId: EMAIL_ID,
      },
    ]);

    const response = await request(app)
      .get('/applications?status=APPLIED&company=example-organization&role=Engineer')
      .set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedService.listApplications).toHaveBeenCalledWith(
      USER_ID,
      {
        status: 'APPLIED',
        company: 'example-organization',
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
        id: APP_ID,
        userId: USER_ID,
        company: { name: 'example-organization', domain: 'example-organization.com' },
        role: { title: 'Engineer', department: 'Engineering' },
        status: 'APPLIED',
        appliedDate: '2026-01-01T00:00:00.000Z',
        recruiter: { name: 'Maya', email: 'maya@stripe.com' },
        sourceEmailId: EMAIL_ID,
      },
      emailHistory: [{ id: EMAIL_ID, subject: 'Application received' }],
      timeline: [
        {
          id: EVT_ID_1,
          eventType: 'STATUS_CHANGED',
          description: 'Application saved',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const response = await request(app).get(`/applications/${APP_ID}`).set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.application.id).toBe(APP_ID);
    expect(response.body.data.emailHistory).toHaveLength(1);
    expect(response.body.data.timeline).toHaveLength(1);
  });

  it('returns a chronological application timeline', async () => {
    mockedService.getApplicationTimeline.mockResolvedValue([
      {
        id: EVT_ID_1,
        applicationId: APP_ID,
        eventType: 'APPLICATION_SUBMITTED',
        timestamp: '2026-01-01T00:00:00.000Z',
        sourceEmailId: EMAIL_ID,
        metadata: { subject: 'Application received' },
        description: 'APPLICATION SUBMITTED from Application received',
      },
      {
        id: EVT_ID_2,
        applicationId: APP_ID,
        eventType: 'INTERVIEW',
        timestamp: '2026-01-02T00:00:00.000Z',
        sourceEmailId: EMAIL_ID,
        metadata: { subject: 'Interview scheduled' },
        description: 'INTERVIEW from Interview scheduled',
      },
    ]);

    const response = await request(app)
      .get(`/applications/${APP_ID}/timeline`)
      .set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(mockedService.getApplicationTimeline).toHaveBeenCalledWith(USER_ID, APP_ID, {
      page: undefined,
      pageSize: undefined,
    });
  });

  it('returns status history for an application', async () => {
    mockedService.getApplicationStatusHistory.mockResolvedValue([
      {
        id: HIST_ID,
        applicationId: APP_ID,
        previousStatus: null,
        status: 'APPLIED',
        source: 'EMAIL',
        sourceEmailId: EMAIL_ID,
        changedByUserId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const response = await request(app)
      .get(`/applications/${APP_ID}/status-history`)
      .set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(mockedService.getApplicationStatusHistory).toHaveBeenCalledWith(USER_ID, APP_ID, {
      page: undefined,
      pageSize: undefined,
    });
  });

  it('updates application status and creates a timeline event', async () => {
    mockedService.updateApplicationStatus.mockResolvedValue({
      application: {
        id: APP_ID,
        userId: USER_ID,
        company: { name: 'example-organization', domain: 'example-organization.com' },
        role: { title: 'Engineer', department: 'Engineering' },
        status: 'INTERVIEW',
        appliedDate: '2026-01-01T00:00:00.000Z',
        recruiter: { name: 'Maya', email: 'maya@stripe.com' },
        sourceEmailId: EMAIL_ID,
      },
      timelineEvent: {
        id: EVT_ID_2,
        eventType: 'STATUS_CHANGED',
        description: 'Application status updated to INTERVIEW',
        timestamp: '2026-01-02T00:00:00.000Z',
      },
    });

    const response = await request(app)
      .patch(`/applications/${APP_ID}/status`)
      .set('x-user-id', USER_ID)
      .send({ status: 'INTERVIEW' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.application.status).toBe('INTERVIEW');
    expect(response.body.data.timelineEvent.description).toContain('INTERVIEW');
    expect(mockedService.updateApplicationStatus).toHaveBeenCalledWith(
      USER_ID,
      APP_ID,
      'INTERVIEW',
      USER_ID,
    );
  });

  it('patches a timeline event', async () => {
    mockedService.updateTimelineEvent.mockResolvedValue({
      id: EVT_ID_2,
      applicationId: APP_ID,
      eventType: 'INTERVIEW',
      timestamp: '2026-01-02T00:00:00.000Z',
      sourceEmailId: EMAIL_ID,
      metadata: { note: 'Updated' },
      description: 'INTERVIEW from Interview scheduled',
    });

    const response = await request(app)
      .patch(`/timeline/${EVT_ID_2}`)
      .set('x-user-id', USER_ID)
      .send({ metadata: { note: 'Updated' } });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(EVT_ID_2);
    expect(mockedService.updateTimelineEvent).toHaveBeenCalledWith(USER_ID, EVT_ID_2, {
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
      .get(`/applications/${APP_ID}/recruiter`)
      .set('x-user-id', USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.recruiter.id).toBe(REC_ID);
    expect(mockedRecruiterService.getRecruiterByApplication).toHaveBeenCalledWith(USER_ID, APP_ID);
  });

  it('rejects invalid statuses', async () => {
    const response = await request(app)
      .patch(`/applications/${APP_ID}/status`)
      .set('x-user-id', USER_ID)
      .send({ status: 'Pending' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
