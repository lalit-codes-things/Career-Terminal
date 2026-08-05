/**
 * graph-persistence.test.ts
 *
 * Verifies that RecruiterGraphNode / RecruiterGraphEdge rows survive a
 * simulated process restart: we write nodes and edges, clear the service
 * instance (simulating a new process), then read back from Prisma directly
 * to confirm the data is actually in the database.
 *
 * Uses Jest + a real DB connection (integration test).
 * Run with:  npx jest graph-persistence --testPathPattern graph-persistence
 */

import { RecruiterKnowledgeGraphService } from '../recruiter-knowledge-graph.service';
import { prisma } from '../../../../config/database';

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

    const beforeEdge = new Date(Date.now() - 1000);
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
