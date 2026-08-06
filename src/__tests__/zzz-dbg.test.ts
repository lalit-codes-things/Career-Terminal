import { PgVectorStore } from '../services/recruiter-intelligence/infrastructure/pgvector.store';

jest.mock('../config/database', () => ({
  prisma: {
    $executeRaw: jest.fn().mockResolvedValue([]),
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
}));

import { prisma } from '../config/database';

it('debug query text', async () => {
  const store = new PgVectorStore();
  await store.search({ vector: [0.1], topK: 5, tenantId: 'tenant-abc' });
  const calls = (prisma as any).$queryRaw.mock.calls;
  console.log('CALL0_ALL', JSON.stringify(calls[0]));
});
