import { prisma } from '../config/database';
import { companyService } from '../services/company';
import { DEFAULT_PAGE_SIZE } from '../domain/pagination';

jest.mock('../config/database', () => {
  const prisma: Record<string, jest.Mock | Record<string, jest.Mock>> = {
    $transaction: jest.fn(),
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    company: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    companyAlias: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    jobApplication: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  (prisma.$transaction as jest.Mock).mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );
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
  $transaction: jest.Mock;
  $executeRawUnsafe: jest.Mock;
  company: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  companyAlias: {
    findFirst: jest.Mock;
    upsert: jest.Mock;
  };
  jobApplication: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
};

describe('CompanyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes company aliases to a canonical company', async () => {
    mockPrisma.companyAlias.findFirst.mockResolvedValue(null);
    mockPrisma.company.findUnique.mockResolvedValue(null);
    mockPrisma.company.create.mockResolvedValue({
      id: 'company-1',
      name: 'Google',
      domain: 'google.com',
      careersUrl: null,
      website: null,
      logoUrl: null,
      industry: null,
      headquarters: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockPrisma.companyAlias.upsert.mockResolvedValue({});

    const result = await companyService.resolveCompany({
      name: 'Google LLC',
      domain: 'google.com',
    });

    expect(result.name).toBe('Google');
    expect(mockPrisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Google',
          domain: 'google.com',
        }),
      }),
    );
    expect(mockPrisma.companyAlias.upsert).toHaveBeenCalled();
  });

  it('collapses facebook aliases into Meta', async () => {
    mockPrisma.companyAlias.findFirst.mockResolvedValue(null);
    mockPrisma.company.findUnique.mockResolvedValue(null);
    mockPrisma.company.create.mockResolvedValue({
      id: 'company-2',
      name: 'Meta',
      domain: 'meta.com',
      careersUrl: null,
      website: null,
      logoUrl: null,
      industry: null,
      headquarters: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockPrisma.companyAlias.upsert.mockResolvedValue({});

    const result = await companyService.resolveCompany({
      name: 'Facebook',
      domain: 'meta.com',
    });

    expect(result.name).toBe('Meta');
  });

  it('lists companies for a user', async () => {
    mockPrisma.company.findMany.mockResolvedValue([
      {
        id: 'company-1',
        name: 'Google',
        domain: 'google.com',
        careersUrl: null,
        website: null,
        logoUrl: null,
        industry: 'Tech',
        headquarters: 'Mountain View',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        applications: [{ id: 'app-1', appliedDate: new Date('2026-01-05T00:00:00.000Z') }],
        recruiters: [{ id: 'rec-1' }],
      },
    ]);

    const companies = await companyService.listCompanies('user-1');

    expect(companies).toHaveLength(1);
    expect(companies[0]?.applicationCount).toBe(1);
    expect(companies[0]?.recruiterCount).toBe(1);
  });

  it('returns company applications for a user', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      {
        id: 'app-1',
        userId: 'user-1',
        appliedDate: new Date('2026-01-05T00:00:00.000Z'),
        status: 'APPLIED',
        roleTitle: 'Engineer',
        companyName: 'Google',
        recruiterName: 'Maya',
        recruiterEmail: 'maya@google.com',
      },
    ]);

    const applications = await companyService.getCompanyApplications('user-1', 'company-1');

    expect(applications).toHaveLength(1);
    expect(applications[0]?.companyName).toBe('Google');
  });

  it('applies default pagination when no pagination args are passed to listCompanies', async () => {
    mockPrisma.company.findMany.mockResolvedValue([]);

    await companyService.listCompanies('user-1');

    expect(mockPrisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: DEFAULT_PAGE_SIZE,
      }),
    );
  });

  it('applies default pagination when no pagination args are passed to getCompanyApplications', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    mockPrisma.jobApplication.findMany.mockResolvedValue([]);

    await companyService.getCompanyApplications('user-1', 'company-1');

    expect(mockPrisma.jobApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: DEFAULT_PAGE_SIZE,
      }),
    );
  });
});
