import { processApplicationTrackingJob } from '../services/queue/workers/application-tracking.worker';
import { prisma } from '../config/database';
import { jobEmailClassifier } from '../services/job-intelligence';
import { applicationCommandService } from '../services/application-command/application-command.service';
import { Job } from 'bullmq';

jest.mock('../config/database', () => ({
  prisma: {
    emailMessage: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../services/job-intelligence', () => ({
  jobEmailClassifier: {
    classify: jest.fn(),
  },
  JobEmailCategory: {
    INTERVIEW_INVITATION: 'INTERVIEW_INVITATION',
    NOT_JOB_RELATED: 'NOT_JOB_RELATED',
  },
}));

jest.mock('../services/application-command/application-command.service', () => ({
  applicationCommandService: {
    processEmailForJobApplication: jest.fn(),
  },
}));

describe('ApplicationTrackingWorker - PROCESS_EMAIL', () => {
  const mockJob = {
    id: 'job-1',
    attemptsMade: 0,
    data: {
      type: 'PROCESS_EMAIL',
      userId: 'user-123',
      emailMessageId: 'email-456',
    },
  } as unknown as Job;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process a job-related email', async () => {
    const mockEmail = {
      id: 'email-456',
      providerMessageId: 'msg-789',
      sender: 'hr@company.com',
      subject: 'Interview Invite',
      bodyText: 'Come for an interview',
      receivedAt: new Date(),
      threadId: 'thread-1',
    };

    (prisma.emailMessage.findUnique as jest.Mock).mockResolvedValue(mockEmail);
    (jobEmailClassifier.classify as jest.Mock).mockResolvedValue({
      category: 'INTERVIEW_INVITATION',
    });

    await processApplicationTrackingJob(mockJob);

    expect(prisma.emailMessage.findUnique).toHaveBeenCalledWith({
      where: { id: 'email-456' },
    });
    expect(jobEmailClassifier.classify).toHaveBeenCalled();
    expect(applicationCommandService.processEmailForJobApplication).toHaveBeenCalled();
  });

  it('should skip a non-job-related email', async () => {
    const mockEmail = {
      id: 'email-456',
      providerMessageId: 'msg-789',
      sender: 'newsletter@spam.com',
      subject: 'Weekly Spam',
      bodyText: 'Buy more things',
      receivedAt: new Date(),
    };

    (prisma.emailMessage.findUnique as jest.Mock).mockResolvedValue(mockEmail);
    (jobEmailClassifier.classify as jest.Mock).mockResolvedValue({
      category: 'NOT_JOB_RELATED',
    });

    await processApplicationTrackingJob(mockJob);

    expect(applicationCommandService.processEmailForJobApplication).not.toHaveBeenCalled();
  });

  it('should skip if email is not found in DB', async () => {
    (prisma.emailMessage.findUnique as jest.Mock).mockResolvedValue(null);

    await processApplicationTrackingJob(mockJob);

    expect(jobEmailClassifier.classify).not.toHaveBeenCalled();
    expect(applicationCommandService.processEmailForJobApplication).not.toHaveBeenCalled();
  });
});
