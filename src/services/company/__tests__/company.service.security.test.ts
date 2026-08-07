import { CompanyService } from '../company.service';

jest.mock('../../ownership/ownership.guard', () => ({
  ownershipGuard: {
    ensureApplicationAccess: jest.fn().mockResolvedValue({ id: 'app-1', userId: 'user-1' }),
    ensureCompanyAccess: jest.fn().mockResolvedValue({ id: 'company-1' }),
  },
}));

jest.mock('../../../config/database', () => {
  const prisma: any = {
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

import { prisma } from '../../../config/database';
import { ownershipGuard } from '../../ownership/ownership.guard';

const mockPrisma = prisma as unknown as {
  company: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  companyAlias: {
    findFirst: jest.Mock;
    upsert: jest.Mock;
  };
  jobApplication: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  recruiter: {
    findFirst: jest.Mock;
  };
  userResume: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  resumeHash: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  applicationResume: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
  $executeRawUnsafe: jest.Mock;
};

describe('CompanyService security', () => {
  const service = new CompanyService();

  describe('linkApplicationToCompany ownership enforcement', () => {
    it('requires userId and validates ownership', async () => {
      await expect(
        service.linkApplicationToCompany('user-1', 'app-1', { name: 'Test Co', domain: 'test.com' }),
      ).rejects.toThrow();
    });

    it('calls ensureApplicationAccess when userId is provided', async () => {
      mockPrisma.jobApplication.update.mockResolvedValue({ id: 'app-1', companyId: 'company-1' });
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'company-1', name: 'Test Co' });
      mockPrisma.company.update.mockResolvedValue({ id: 'company-1', name: 'Test Co', domain: 'test.com' });
      mockPrisma.companyAlias.upsert.mockResolvedValue({ id: 'alias-1' });

      await service.linkApplicationToCompany('user-1', 'app-1', { name: 'Test Co', domain: 'test.com' });

      expect(ownershipGuard.ensureApplicationAccess).toHaveBeenCalledWith('user-1', 'app-1', expect.anything());
    });
  });
});
