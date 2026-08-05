import { OpportunityService } from '../services/opportunity/opportunity.service';
import { companyService } from '../services/company';
import type { OpportunityResolutionInput } from '../services/opportunity/opportunity.service';
import { acquireLock, releaseLock } from '../lib/mutex';
import { executeWithTransientRetry } from '../db/transaction-utils';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
    opportunity: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    opportunityObservation: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    company: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('../lib/mutex', () => ({
  acquireLock: jest.fn(() => Promise.resolve('mock-lock-token')),
  releaseLock: jest.fn(() => Promise.resolve()),
}));

jest.mock('../db/transaction-utils', () => ({
  executeWithTransientRetry: jest.fn(
    async (_client: unknown, run: (tx: unknown) => Promise<unknown>) => run(prisma as unknown),
  ),
}));

jest.mock('../services/company', () => ({
  companyService: {
    resolveCompany: jest.fn(),
  },
}));

type MockPrisma = {
  opportunity: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  opportunityObservation: {
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  company: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

const mockPrisma = prisma as unknown as MockPrisma;

const COMPANY_1 = {
  id: 'company-1',
  name: 'example-organization',
  domain: 'example-organization.com',
  careersUrl: null,
  website: null,
  logoUrl: null,
  industry: null,
  headquarters: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const OPPORTUNITY_EXISTING = {
  id: 'opp-1',
  companyId: COMPANY_1.id,
  title: 'Senior Software Engineer',
  description: null,
  location: 'San Francisco, CA',
  salaryRange: null,
  requirements: null,
  url: null,
  sourceMetadata: null,
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
  isCurrent: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const INPUT: OpportunityResolutionInput = {
  companyName: 'example-organization',
  companyDomain: 'example-organization.com',
  roleTitle: 'Senior Software Engineer',
  location: 'San Francisco, CA',
  url: 'https://acme.com/jobs/senior-swe',
  sourceMetadata: { source: 'email' },
};

describe('OpportunityService', () => {
  let service: OpportunityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OpportunityService(prisma);

    (companyService.resolveCompany as jest.Mock).mockResolvedValue(COMPANY_1);
    mockPrisma.opportunityObservation.create.mockResolvedValue({
      id: 'obs-1',
      opportunityId: OPPORTUNITY_EXISTING.id,
      userId: null,
      sourceType: 'EMAIL',
      sourceId: 'test',
      extractionRunId: null,
      observedAt: new Date(),
      title: null,
      description: null,
      location: null,
      compensation: null,
      requirements: [],
      department: null,
      employmentType: null,
      remotePolicy: null,
      seniority: null,
      hiringInfo: {},
      confidence: 1.0,
      url: null,
      isCurrent: true,
      supersededById: null,
      supersededAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.opportunityObservation.updateMany.mockResolvedValue({ count: 0 });
  });

  it('creates a new opportunity when no match exists (fallback path)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    mockPrisma.opportunity.create.mockResolvedValue({
      ...OPPORTUNITY_EXISTING,
      id: 'opp-new',
      title: INPUT.roleTitle,
      url: INPUT.url ?? null,
      location: INPUT.location ?? null,
    });
    mockPrisma.opportunity.update.mockImplementation(async (_: unknown) => OPPORTUNITY_EXISTING);

    const result = await service.resolve(INPUT);

    expect(result.isNew).toBe(true);
    expect(result.opportunityId).toBe('opp-new');
    expect(acquireLock).toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
    expect(executeWithTransientRetry).toHaveBeenCalled();
    expect(mockPrisma.opportunity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          company: { connect: { id: COMPANY_1.id } },
          title: INPUT.roleTitle,
          location: INPUT.location,
          url: INPUT.url,
          firstSeenAt: expect.any(Date),
          lastSeenAt: expect.any(Date),
          isCurrent: true,
        }),
      }),
    );
  });

  it('matches existing opportunity by exact URL (priority 1)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(OPPORTUNITY_EXISTING);
    mockPrisma.opportunity.findUnique.mockResolvedValue({
      ...OPPORTUNITY_EXISTING,
      sourceMetadata: null,
    });
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    mockPrisma.opportunity.update.mockImplementation(async (_: unknown) => OPPORTUNITY_EXISTING);

    const result = await service.resolve(INPUT);

    expect(result.isNew).toBe(false);
    expect(result.opportunityId).toBe(OPPORTUNITY_EXISTING.id);
    expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_1.id,
          url: INPUT.url,
        }),
      }),
    );
    // Touches existing row (update last_seen_at)
    expect(mockPrisma.opportunity.update).toHaveBeenCalled();
  });

  it('matches existing opportunity by fuzzy title + location when URL not available', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.findMany.mockResolvedValue([
      {
        id: OPPORTUNITY_EXISTING.id,
        title: 'Senior Software Engineer',
        location: 'San Francisco, CA',
        description: null,
        salaryRange: null,
        requirements: null,
        url: null,
      },
    ]);
    mockPrisma.opportunity.update.mockImplementation(async (_: unknown) => OPPORTUNITY_EXISTING);

    const { opportunityId, isNew } = await service.resolve({
      companyName: INPUT.companyName,
      companyDomain: INPUT.companyDomain,
      roleTitle: 'Software Engineer', // stripped -> matches "Software Engineer"
      location: 'San Francisco', // normalized -> substring of "San Francisco, CA"
    });

    expect(isNew).toBe(false);
    expect(opportunityId).toBe(OPPORTUNITY_EXISTING.id);
  });

  it('matches existing opportunity by title-only when location differs (priority 3)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.findMany.mockResolvedValue([
      {
        id: 'opp-title-only',
        title: 'Senior Software Engineer',
        location: 'New York, NY',
        description: null,
        salaryRange: null,
        requirements: null,
        url: null,
      },
    ]);
    mockPrisma.opportunity.update.mockImplementation(async (_: unknown) => OPPORTUNITY_EXISTING);

    const { opportunityId, isNew } = await service.resolve({
      companyName: INPUT.companyName,
      companyDomain: INPUT.companyDomain,
      roleTitle: 'Lead Senior Software Engineer', // title overlaps
      location: 'Remote', // mismatching
    });

    expect(isNew).toBe(false);
    expect(opportunityId).toBe('opp-title-only');
  });

  it('releases the distributed lock even on resolution failure', async () => {
    mockPrisma.opportunity.findFirst.mockRejectedValue(new Error('DB down'));

    const promise = service.resolve(INPUT);
    await expect(promise).rejects.toThrow('DB down');

    expect(releaseLock).toHaveBeenCalled();
  });

  it('matches existing opportunity by normalized title + location (Step 0b)', async () => {
    // URL miss, then normalized match hit
    mockPrisma.opportunity.findFirst
      .mockResolvedValueOnce(null) // URL miss (Step 1)
      .mockResolvedValueOnce(OPPORTUNITY_EXISTING); // normalized match (Step 0b)
    mockPrisma.opportunity.update.mockImplementation(async (_: unknown) => OPPORTUNITY_EXISTING);

    const result = await service.resolve(INPUT);

    expect(result.isNew).toBe(false);
    expect(result.opportunityId).toBe(OPPORTUNITY_EXISTING.id);
    // Verify the normalized match query was issued
    expect(mockPrisma.opportunity.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_1.id,
          normalizedTitle: expect.any(String),
          normalizedLocation: expect.any(String),
        }),
      }),
    );
  });

  it('falls back to creating new when P2002 unique constraint race occurs (concurrent creation)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null); // URL + normalized miss
    mockPrisma.opportunity.findMany.mockResolvedValue([]); // no fuzzy candidates

    // create throws P2002 (concurrent insert won the race)
    const p2002Error = new Error('duplicate key') as Error & { code?: string };
    p2002Error.code = 'P2002';
    mockPrisma.opportunity.create.mockRejectedValueOnce(p2002Error);
    // After P2002, the normalized findFirst returns the existing row
    mockPrisma.opportunity.findFirst
      .mockResolvedValueOnce(null) // URL miss
      .mockResolvedValueOnce(null) // normalized miss first time
      .mockResolvedValueOnce(OPPORTUNITY_EXISTING); // normalized hit on retry after P2002
    mockPrisma.opportunity.update.mockImplementation(async (_: unknown) => OPPORTUNITY_EXISTING);

    const result = await service.resolve(INPUT);

    expect(result.isNew).toBe(false);
    expect(result.opportunityId).toBe(OPPORTUNITY_EXISTING.id);
  });
});

describe('OpportunityService fuzzy matching helpers', () => {
  it('is idempotent — two sequential resolve calls with same data converge on a single opportunity', async () => {
    jest.clearAllMocks();
    const service = new OpportunityService(prisma);

    (companyService.resolveCompany as jest.Mock).mockResolvedValue(COMPANY_1);

    // First call: create a new opportunity
    mockPrisma.opportunity.findFirst
      .mockResolvedValueOnce(null) // URL miss (Step 1)
      .mockResolvedValueOnce(null) // normalized miss (Step 0b)
      .mockResolvedValueOnce(null) // URL miss second resolve (Step 1)
      .mockResolvedValueOnce(OPPORTUNITY_EXISTING); // normalized hit second resolve (Step 0b)
    mockPrisma.opportunity.findMany
      .mockResolvedValueOnce([]) // no fuzzy candidates first resolve (Step 2)
      .mockResolvedValueOnce([OPPORTUNITY_EXISTING]); // fuzzy hits second resolve
    mockPrisma.opportunity.create.mockResolvedValueOnce(OPPORTUNITY_EXISTING);
    mockPrisma.opportunity.update.mockImplementation(async (_: unknown) => OPPORTUNITY_EXISTING);

    const first = await service.resolve(INPUT);
    expect(first.isNew).toBe(true);

    const second = await service.resolve(INPUT);
    expect(second.isNew).toBe(false);
    expect(second.opportunityId).toBe(first.opportunityId);
  });
});
