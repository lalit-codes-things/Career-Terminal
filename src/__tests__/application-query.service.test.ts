import { prisma } from '../config/database';
import { applicationQueryService } from '../services/application-query/application-query.service';
import { DEFAULT_PAGE_SIZE } from '../domain/pagination';

jest.mock('../config/database', () => {
  const prisma = {
    jobApplication: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  return {
    prisma,
    dbRouter: {
      read: jest.fn().mockReturnValue(prisma),
      write: jest.fn().mockReturnValue(prisma),
      withReplicaFallback: jest.fn(),
      getHealth: jest.fn(),
      disconnect: jest.fn(),
    },
  };
});

const mockPrisma = prisma as unknown as {
  jobApplication: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
};

describe('ApplicationQueryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies default pagination when no pagination args are passed to listApplications', async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([]);

    await applicationQueryService.listApplications('user-1');

    expect(mockPrisma.jobApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: DEFAULT_PAGE_SIZE,
      }),
    );
  });
});
