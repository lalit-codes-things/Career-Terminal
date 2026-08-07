/**
 * Security hardening — vector search tenant isolation.
 *
 * Regression tests proving cross-tenant leakage cannot occur:
 *   1. PgVectorStore search SQL always carries a `user_id` predicate bound to
 *      the requesting tenant (the canonical tenant identifier).
 *   2. InMemoryVectorStore (test double) filters strictly by tenant.
 *   3. HybridRetrievalService propagates tenant context into every query.
 */
import { InMemoryVectorStore } from '../in-memory-vector.store';
import { PgVectorStore } from '../pgvector.store';
import { HybridRetrievalService } from '../../vector-search/hybrid-retrieval.service';
import { StubEmbeddingAdapter } from '../../ai/adapters/stub-embedding.adapter';
import type { Embedding } from '../../../../domain/recruiter-intelligence/semantic-representation/contracts';

jest.mock('../../../../config/database', () => ({
  prisma: {
    $executeRaw: jest.fn().mockResolvedValue([]),
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
  dbRouter: {
    read: jest.fn(),
    write: jest.fn(),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },
}));

import { prisma } from '../../../../config/database';

const mockPrisma = prisma as unknown as {
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
};

function makeEmbedding(tenantId: string, entityId: string, vector: number[]): Embedding {
  return {
    embeddingId: `${tenantId}-${entityId}`,
    vector,
    dimensions: vector.length as 384,
    text: `text for ${entityId}`,
    metadata: {
      entityType: 'recruiter_profile',
      entityId,
      tenantId,
      sourceTextLength: 10,
      modelVersion: 'test',
      createdAt: new Date(),
    },
  };
}

describe('Vector search tenant isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PgVectorStore — SQL tenant predicate', () => {
    it('scopes every table search with a user_id predicate equal to the tenant', async () => {
      const store = new PgVectorStore();
      await store.search({ vector: [0.1, 0.2], topK: 5, tenantId: 'tenant-abc' });

      const queryCalls = mockPrisma.$queryRaw.mock.calls;
      expect(queryCalls.length).toBe(3); // three embedding tables

      // Each query must carry the `user_id` predicate (tenant scoping).
      for (const call of queryCalls) {
        const queryText = call[0].join('');
        const hasTenantPredicate =
          /FROM (candidate_profile_embeddings|opportunity_embeddings|application_embeddings)[\s\S]*WHERE user_id =/.test(
            queryText,
          );
        expect(hasTenantPredicate).toBe(true);
      }

      // The bound tenant parameter flows into every query.
      const tenantParams = queryCalls.flatMap((c) => (c as unknown[]).slice(1).filter((p) => p === 'tenant-abc'));
      expect(tenantParams.length).toBeGreaterThanOrEqual(3);
    });

    it('never returns rows from another tenant when the tenant parameter differs', async () => {
      const store = new PgVectorStore();
      mockPrisma.$queryRaw.mockImplementation(
        async (_strings: TemplateStringsArray, ...params: unknown[]) => {
          // Simulate the DB honouring the user_id predicate: only rows whose
          // stored tenant matches the bound tenant parameter survive.
          // Tagged-template param layout: [vector, tenantId, vector, minSim, vector, topK]
          const tenant = String(params[1]);
          const rows = [
            {
              id: 'r1',
              entity_id: 'e1',
              entity_type: 'recruiter_profile',
              score: 0.9,
              metadata: { entityType: 'recruiter_profile', text: 't1 text' },
              _storedTenant: 'tenant-1',
            },
            {
              id: 'r2',
              entity_id: 'e2',
              entity_type: 'recruiter_profile',
              score: 0.8,
              metadata: { entityType: 'recruiter_profile', text: 't2 text' },
              _storedTenant: 'tenant-2',
            },
          ];
          return rows.filter((r) => r._storedTenant === tenant);
        },
      );

      const results = await store.search({ vector: [0.1, 0.2], topK: 5, tenantId: 'tenant-1' });
      const entityIds = results.map((r) => r.entityId);
      expect(entityIds).toContain('e1');
      expect(entityIds).not.toContain('e2');
    });
  });

  describe('InMemoryVectorStore — strict tenant filter', () => {
    it('returns only embeddings owned by the requesting tenant', async () => {
      const store = new InMemoryVectorStore();
      const v = [0.1, 0.2, 0.3, 0.4];
      await store.store([
        makeEmbedding('tenant-1', 'e1', v),
        makeEmbedding('tenant-2', 'e2', v),
        makeEmbedding('tenant-1', 'e3', v),
      ]);

      const results = await store.search({ vector: v, topK: 10, tenantId: 'tenant-1' });
      expect(results.map((r) => r.entityId).sort()).toEqual(['e1', 'e3']);
    });

    it('returns nothing when the tenant has no embeddings', async () => {
      const store = new InMemoryVectorStore();
      await store.store([makeEmbedding('tenant-1', 'e1', [0.1, 0.2, 0.3, 0.4])]);

      const results = await store.search({ vector: [0.1, 0.2, 0.3, 0.4], topK: 10, tenantId: 'tenant-9' });
      expect(results).toEqual([]);
    });
  });

  describe('HybridRetrievalService — tenant propagation', () => {
    it('passes the tenant through to the vector store on vector queries', async () => {
      const store = new InMemoryVectorStore();
      const searchSpy = jest.spyOn(store, 'search');
      const service = new HybridRetrievalService(new StubEmbeddingAdapter(), store);
      const v = [0.1, 0.2, 0.3, 0.4];

      await service.search({
        textQuery: 'react developer',
        tenantId: 'tenant-7',
        vectorQuery: { vector: v, topK: 2, tenantId: 'tenant-7' },
      });

      expect(searchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-7' }),
      );
    });

    it('passes the tenant through on text-only queries', async () => {
      const store = new InMemoryVectorStore();
      const searchSpy = jest.spyOn(store, 'search');
      const service = new HybridRetrievalService(new StubEmbeddingAdapter(), store);

      await service.search({ textQuery: 'python backend', tenantId: 'tenant-8' });

      expect(searchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-8' }),
      );
    });
  });
});
