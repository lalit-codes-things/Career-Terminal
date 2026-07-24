import { prisma } from '../config/database';
import { recruiterService } from '../services/recruiter';

jest.mock('../config/database', () => ({
  prisma: {
    company: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    companyAlias: { findFirst: jest.fn(), upsert: jest.fn() },
    recruiter: { upsert: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    jobApplication: { update: jest.fn(), findFirst: jest.fn() },
    emailMessage: { update: jest.fn() },
  },
}));

jest.mock('../services/company', () => ({
  companyService: {
    resolveCompany: jest.fn(),
  },
}));

import { companyService } from '../services/company';

const mockPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  companyAlias: { findFirst: jest.Mock; upsert: jest.Mock };
  recruiter: { upsert: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  jobApplication: { update: jest.Mock; findFirst: jest.Mock };
  emailMessage: { update: jest.Mock };
};

const mockedCompanyService = companyService as unknown as {
  resolveCompany: jest.Mock;
};

describe('RecruiterService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('syncs a recruiter from an email and links the application', async () => {
    mockedCompanyService.resolveCompany.mockResolvedValue({
      id: 'company-1',
      name: 'Stripe',
      domain: 'stripe.com',
      careersUrl: null,
      website: null,
      logoUrl: null,
      industry: null,
      headquarters: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockPrisma.jobApplication.findFirst.mockResolvedValue({
      id: 'app-1',
      userId: 'user-1',
    });
    mockPrisma.recruiter.upsert.mockResolvedValue({
      id: 'rec-1',
      companyId: 'company-1',
      name: 'Maya Chen',
      email: 'maya@stripe.com',
      title: 'Recruiter',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      company: { id: 'company-1', name: 'Stripe', domain: 'stripe.com' },
    });

    const result = await recruiterService.syncRecruiterFromEmail({
      userId: 'user-1',
      application: {
        id: 'app-1',
        userId: 'user-1',
        companyName: 'Stripe',
        companyDomain: 'stripe.com',
        roleTitle: 'Engineer',
        recruiterName: 'Maya Chen',
        recruiterEmail: 'maya@stripe.com',
      },
      email: {
        emailId: 'email-1',
        sender: 'maya@stripe.com',
        subject: 'Application received',
        bodyText: 'Thanks for applying',
        receivedAt: new Date('2026-01-02T00:00:00.000Z'),
        threadId: 'thread-1',
      },
      company: {
        name: 'Stripe',
        domain: 'stripe.com',
      },
      recruiter: {
        name: 'Maya Chen',
        email: 'maya@stripe.com',
      },
    });

    expect(mockedCompanyService.resolveCompany).toHaveBeenCalled();
    expect(mockPrisma.recruiter.upsert).toHaveBeenCalled();
    expect(mockPrisma.jobApplication.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: {
        recruiterId: 'rec-1',
        recruiterName: 'Maya Chen',
        recruiterEmail: 'maya@stripe.com',
      },
    });
    expect(mockPrisma.emailMessage.update).toHaveBeenCalledWith({
      where: {
        unique_user_message: {
          userId: 'user-1',
          providerMessageId: 'email-1',
        },
      },
      data: {
        application: {
          connect: {
            id: 'app-1',
          },
        },
        recruiter: {
          connect: {
            id: 'rec-1',
          },
        },
      },
    });
    expect(result?.id).toBe('rec-1');
  });

  it('computes recruiter insights from linked emails', async () => {
    mockPrisma.recruiter.findFirst.mockResolvedValue({
      id: 'rec-1',
      companyId: 'company-1',
      name: 'Maya Chen',
      email: 'maya@stripe.com',
      title: 'Recruiter',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      company: { id: 'company-1', name: 'Stripe', domain: 'stripe.com' },
      applications: [
        {
          id: 'app-1',
          appliedDate: new Date(),
          status: 'APPLIED',
          roleTitle: 'Engineer',
          companyName: 'Stripe',
        },
      ],
      emails: [
        {
          id: 'email-1',
          applicationId: 'app-1',
          providerMessageId: 'msg-1',
          subject: 'Hello',
          sender: 'maya@stripe.com',
          threadId: 'thread-1',
          receivedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'email-2',
          applicationId: 'app-1',
          providerMessageId: 'msg-2',
          subject: 'Reply',
          sender: 'user@example.com',
          threadId: 'thread-1',
          receivedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    const insight = await recruiterService.getRecruiter('user-1', 'rec-1');

    expect(insight.totalEmails).toBe(2);
    expect(insight.averageResponseTimeMinutes).toBe(1440);
    expect(insight.firstContactAt).toBe('2026-01-01T00:00:00.000Z');
    expect(insight.lastContactAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
