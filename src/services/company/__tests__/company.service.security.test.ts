import { CompanyService } from '../company.service';
import { OwnershipGuard } from '../ownership/ownership.guard';

jest.mock('../ownership/ownership.guard', () => ({
  ownershipGuard: {
    ensureApplicationAccess: jest.fn().mockResolvedValue({ id: 'app-1', userId: 'user-1', legacyUserId: null }),
    ensureCompanyAccess: jest.fn().mockResolvedValue({ id: 'company-1' }),
  },
}));

jest.mock('../../config/database', () => {
  const prisma = {
    company: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    companyAlias: { findFirst: jest.fn(), upsert: jest.fn() },
    jobApplication: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    recruiter: { findFirst: jest.fn() },
    userResume: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    resumeHash: { findUnique: jest.fn(), create: jest.fn() },
    applicationResume: { findFirst: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
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

import { prisma } from '../../config/database';

const mockPrisma = prisma as unknown as Record<string, unknown>;

describe('CompanyService security', () => {
  const service = new CompanyService();

  describe('linkApplicationToCompany ownership enforcement', () => {
    it('requires userId and validates ownership', async () => {
      await expect(
        service.linkApplicationToCompany('app-1', { name: 'Test Co', domain: 'test.com' }),
      ).rejects.toThrow();
    });

    it('calls ensureApplicationAccess when userId is provided', async () => {
      mockPrisma.jobApplication.update.mockResolvedValue({ id: 'app-1', companyId: 'company-1' });
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'company-1', name: 'Test Co' });

      await service.linkApplicationToCompany('user-1', 'app-1', { name: 'Test Co', domain: 'test.com' });

      expect(ownershipGuard.ensureApplicationAccess).toHaveBeenCalledWith('user-1', 'app-1', prisma);
    });
  });
});