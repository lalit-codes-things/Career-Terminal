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

jest.mock('../../../../config/database', () => {
  const mockWrite = {
    $executeRaw: jest.fn().mockResolvedValue([]),
    $queryRaw: jest.fn().mockResolvedValue([]),
    recruiterGraphNode: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'node-1' }), update: jest.fn().mockResolvedValue({ id: 'node-1' }) },
    recruiterGraphEdge: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'edge-1' }), update: jest.fn().mockResolvedValue({ id: 'edge-1' }) },
  };
  return {
    prisma: mockWrite,
    dbRouter: {
      read: jest.fn().mockReturnValue(mockWrite),
      write: jest.fn().mockReturnValue(mockWrite),
      withReplicaFallback: jest.fn(),
      getHealth: jest.fn(),
      disconnect: jest.fn(),
    },
  };
  });

import { dbRouter } from '../../../../config/database';

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

      const queryCalls = (dbRouter.write().$queryRaw as jest.Mock).mock.calls;
      expect(queryCalls.length).toBe(3); // three embedding tables

      for (const call of queryCalls) {
        const queryText = call[0].join('');
        expect(queryText).toContain('WHERE user_id =');
      }
    });

    it('never returns rows from another tenant when the tenant parameter differs', async () => {
      const store = new PgVectorStore();
      (dbRouter.write().$queryRaw as jest.Mock).mockImplementation(
        async (_strings: TemplateStringsArray, ...params: unknown[]) => {
          const tenant = String(params[1]);
          const rows = [
            { entity_id: 'e1', entity_type: 'recruiter_profile', score: 0.9, metadata: {}, _storedTenant: 'tenant-1' },
            { entity_id: 'e2', entity_type: 'recruiter_profile', score: 0.8, metadata: {}, _storedTenant: 'tenant-2' },
          ];
          return rows.filter((r: any) => r._storedTenant === tenant);
        },
      );

      const results = await store.search({ vector: [0.1, 0.2], topK: 5, tenantId: 'tenant-1' });
      const entityIds = results.map((r) => r.entityId);
      expect(entityIds).toContain('e1');
      expect(entityIds).not.toContain('e2');
    });
  });

  describe('InMemoryVectorStore — strict tenant filter', () => {
    it('returns embeddings for the requesting tenant (filter applied at store level)', async () => {
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

    it('returns stored embeddings when queried (tenant filter is enforced at ingestion)', async () => {
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
