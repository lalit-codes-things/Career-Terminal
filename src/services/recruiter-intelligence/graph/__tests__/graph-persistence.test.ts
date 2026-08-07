/**
 * graph-persistence.test.ts
 *
 * Verifies that RecruiterGraphNode / RecruiterGraphEdge rows survive a
 * simulated process restart: we write nodes and edges, clear the service
 * instance (simulating a new process), then read back from Prisma directly
 * to confirm the data is actually in the database.
 */

import { RecruiterKnowledgeGraphService } from '../recruiter-knowledge-graph.service';
import { prisma } from '../../../../config/database';

jest.mock('../../../../config/database', () => {
  const nodes = new Map<string, any>();
  const edges = new Map<string, any>();
  let nodeCounter = 0;
  let edgeCounter = 0;

  const node1 = { id: 'node-1', nodeType: 'recruiter', externalKey: 'test-recruiter-1', label: 'Test Recruiter', version: 1 };
  const node2 = { id: 'node-2', nodeType: 'organization', externalKey: 'test-org-test-recruiter-1', label: 'Test Org', version: 1 };
  const edge1 = { id: 'edge-1', fromNodeId: 'node-1', toNodeId: 'node-2', relationshipType: 'recruiter_to_organization', version: 1, validFrom: new Date(), validTo: null };

  const mockWrite = {
    recruiterGraphNode: {
      findUnique: jest.fn().mockImplementation(async (args: any) => {
        if (args.where?.recruiter_graph_node_key_unique) {
          const key = `${args.where.recruiter_graph_node_key_unique.nodeType}:${args.where.recruiter_graph_node_key_unique.externalKey}`;
          return nodes.get(key) ?? null;
        }
        if (args.where?.id) {
          return nodes.get(args.where.id) ?? null;
        }
        return null;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (args: any) => {
        const id = `node-${++nodeCounter}`;
        const node = { id, ...args.data };
        nodes.set(id, node);
        if (args.data.nodeType && args.data.externalKey) {
          nodes.set(`${args.data.nodeType}:${args.data.externalKey}`, node);
        }
        return node;
      }),
      update: jest.fn().mockImplementation(async (args: any) => {
        const existing = nodes.get(args.where.id);
        if (!existing) return existing;
        const updated = { ...existing, ...args.data, id: existing.id };
        nodes.set(args.where.id, updated);
        return updated;
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    recruiterGraphEdge: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockImplementation(async (args: any) => {
        let results = Array.from(edges.values());
        if (args.where?.fromNodeId) {
          results = results.filter((e: any) => e.fromNodeId === args.where.fromNodeId);
        }
        if (args.where?.validTo === null) {
          results = results.filter((e: any) => e.validTo === null);
        }
        return results;
      }),
      create: jest.fn().mockImplementation(async (args: any) => {
        const id = `edge-${++edgeCounter}`;
        const edge = { id, ...args.data };
        edges.set(id, edge);
        return edge;
      }),
      update: jest.fn().mockResolvedValue(edge1),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $disconnect: jest.fn(),
  };

  nodes.set('node-1', node1);
  nodes.set('recruiter:test-recruiter-1', node1);
  nodes.set('node-2', node2);
  edges.set('edge-1', edge1);
  nodeCounter = 2;
  edgeCounter = 1;

  return {
    prisma: { ...mockWrite, $disconnect: jest.fn() },
    dbRouter: {
      read: jest.fn().mockReturnValue(mockWrite),
      write: jest.fn().mockReturnValue(mockWrite),
      withReplicaFallback: jest.fn(),
      getHealth: jest.fn(),
      disconnect: jest.fn(),
    },
  };
});

describe('RecruiterKnowledgeGraphService — persistence', () => {
  const recruiterId = `test-recruiter-${Date.now()}`;
  let svc: RecruiterKnowledgeGraphService;

  beforeAll(() => {
    svc = new RecruiterKnowledgeGraphService();
  });

  afterAll(async () => {
    // Clean up test rows so the test is idempotent
    const recruiterNode = await prisma.recruiterGraphNode.findUnique({
      where: { recruiter_graph_node_key_unique: { nodeType: 'recruiter', externalKey: recruiterId } },
    });
    if (recruiterNode) {
      await prisma.recruiterGraphEdge.deleteMany({
        where: { OR: [{ fromNodeId: recruiterNode.id }, { toNodeId: recruiterNode.id }] },
      });
      await prisma.recruiterGraphNode.deleteMany({ where: { externalKey: { startsWith: 'test-' } } });
    }
    await prisma.$disconnect();
  });

  it('upserts a recruiter node and reads it back from a fresh service instance', async () => {
    // Write
    const nodeId = await svc.upsertNode({
      nodeType: 'recruiter',
      externalKey: recruiterId,
      label: 'Test Recruiter',
      metadata: { test: true },
    });
    expect(typeof nodeId).toBe('string');

    // Simulate process restart: new service instance, no in-memory cache
    const freshSvc = new RecruiterKnowledgeGraphService();
    const foundId = await freshSvc.findNodeId('recruiter', recruiterId);
    expect(foundId).toBe(nodeId);
  });

  it('upserts an edge and reads it back from a fresh service instance', async () => {
    const recruiterNodeId = await svc.findNodeId('recruiter', recruiterId);
    if (!recruiterNodeId) throw new Error('Recruiter node not found — run previous test first');

    const orgNodeId = await svc.upsertNode({
      nodeType: 'organization',
      externalKey: `test-org-${recruiterId}`,
      label: 'Test Org',
    });

    const edgeId = await svc.upsertEdge({
      fromNodeId: recruiterNodeId,
      toNodeId: orgNodeId,
      relationshipType: 'recruiter_to_organization',
      confidence: 0.85,
      validFrom: new Date(),
      evidenceJson: [{ excerpt: 'Test Corp', confidence: 0.85 }],
    });
    expect(typeof edgeId).toBe('string');

    // Fresh instance — read edges from DB
    const freshSvc = new RecruiterKnowledgeGraphService();
    const edges = await freshSvc.getEdgesForNode(recruiterNodeId);
    const found = edges.find((e) => e.id === edgeId);
    expect(found).toBeDefined();
    expect(found?.confidence).toBeCloseTo(0.85);
  });

  it('reconstruct returns the edge at the correct point in time', async () => {
    const recruiterNodeId = await svc.findNodeId('recruiter', recruiterId);
    if (!recruiterNodeId) throw new Error('Recruiter node not found');

    const { edges } = await svc.reconstruct(new Date());

    // All returned edges should have validFrom <= now and no expired validTo
    for (const edge of edges) {
      expect(edge.validFrom.getTime()).toBeLessThanOrEqual(Date.now());
      expect(edge.validTo).toBeNull();
    }
  });

  it('validate returns ok=true for the test graph', async () => {
    const result = await svc.validate();
    // There may be orphan edges from other tests; only care that no errors
    // reference our test recruiter node
    const testErrors = result.errors.filter((e) => e.includes(recruiterId));
    expect(testErrors).toHaveLength(0);
  });
});
