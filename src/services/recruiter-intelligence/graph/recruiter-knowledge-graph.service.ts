/**
 * RecruiterKnowledgeGraphService
 *
 * All reads and writes go through RecruiterGraphNode / RecruiterGraphEdge
 * Prisma tables. The old in-memory Map/Set is gone — graph state survives
 * process restarts.
 *
 * Public surface:
 *   upsertNode(...)          — idempotent node create/update
 *   upsertEdge(...)          — idempotent edge create/update
 *   expireEdge(id)           — set validTo = now on an edge
 *   getNodesForRecruiter(id) — all nodes reachable from a recruiter node
 *   getEdgesForNode(nodeId)  — all edges incident on a node
 *   reconstruct(asOf)        — point-in-time graph snapshot
 *   validate()               — structural integrity check (DB-backed)
 */

import { prisma } from '../../../config/database';
import { Prisma } from '@prisma/client';

export type KgNodeType =
  | 'recruiter'
  | 'organization'
  | 'team'
  | 'department'
  | 'office'
  | 'role'
  | 'skill'
  | 'technology'
  | 'location'
  | 'hiring_domain'
  | 'candidate'
  | 'opportunity';

export type KgRelationshipType =
  | 'recruiter_to_recruiter'
  | 'recruiter_to_organization'
  | 'recruiter_to_team'
  | 'recruiter_to_department'
  | 'recruiter_to_candidate'
  | 'recruiter_to_opportunity'
  | 'recruiter_to_skill'
  | 'recruiter_to_technology'
  | 'recruiter_to_location'
  | 'recruiter_to_hiring_domain'
  | 'organization_to_team'
  | 'organization_to_department'
  | 'organization_to_office';

export interface UpsertNodeInput {
  nodeType: KgNodeType;
  externalKey: string;
  label: string;
  metadata?: Record<string, unknown>;
}

export interface UpsertEdgeInput {
  fromNodeId: string;
  toNodeId: string;
  relationshipType: KgRelationshipType;
  confidence: number;
  validFrom: Date;
  validTo?: Date;
  evidenceJson?: object[];
  provenanceJson?: object;
}

export class RecruiterKnowledgeGraphService {
  // ── Node operations ────────────────────────────────────────────────────────

  /** Upsert a graph node by (nodeType, externalKey). Returns the DB id. */
  async upsertNode(input: UpsertNodeInput): Promise<string> {
    const existing = await prisma.recruiterGraphNode.findUnique({
      where: {
        recruiter_graph_node_key_unique: {
          nodeType: input.nodeType,
          externalKey: input.externalKey,
        },
      },
    });

    if (existing) {
      const updated = await prisma.recruiterGraphNode.update({
        where: { id: existing.id },
        data: {
          label: input.label || existing.label,
           metadata: { ...(existing.metadata as Record<string, unknown>), ...(input.metadata ?? {}) } as unknown as Prisma.InputJsonValue,
          version: existing.version + 1,
        },
      });
      return updated.id;
    }

    const created = await prisma.recruiterGraphNode.create({
      data: {
        nodeType: input.nodeType,
        externalKey: input.externalKey,
        label: input.label,
         metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
        version: 1,
      },
    });
    return created.id;
  }

  /** Upsert an edge between two existing nodes. Returns the DB id. */
  async upsertEdge(input: UpsertEdgeInput): Promise<string> {
    const confidence = Math.max(0, Math.min(1, input.confidence));

    const existing = await prisma.recruiterGraphEdge.findFirst({
      where: {
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        relationshipType: input.relationshipType,
        validTo: null, // only match open (not expired) edges
      },
    });

    if (existing) {
      const mergedEvidence = [
        ...((existing.evidenceJson as object[]) ?? []),
        ...(input.evidenceJson ?? []),
      ].slice(-20); // cap evidence list

      const updated = await prisma.recruiterGraphEdge.update({
        where: { id: existing.id },
        data: {
          confidence: Math.max(existing.confidence, confidence),
          evidenceJson: mergedEvidence,
          version: existing.version + 1,
        },
      });
      return updated.id;
    }

    const created = await prisma.recruiterGraphEdge.create({
      data: {
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        relationshipType: input.relationshipType,
        confidence,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
        evidenceJson: input.evidenceJson ?? [],
        provenanceJson: input.provenanceJson ?? {},
        metadata: {},
        version: 1,
      },
    });
    return created.id;
  }

  /** Set validTo = expiredAt on an edge (soft-delete). */
  async expireEdge(edgeId: string, expiredAt = new Date()): Promise<boolean> {
    try {
      await prisma.recruiterGraphEdge.update({
        where: { id: edgeId },
        data: { validTo: expiredAt, version: { increment: 1 } },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Query operations ───────────────────────────────────────────────────────

  /** Return the DB id for a node by type + externalKey (null if not found). */
  async findNodeId(nodeType: KgNodeType, externalKey: string): Promise<string | null> {
    const node = await prisma.recruiterGraphNode.findUnique({
      where: {
        recruiter_graph_node_key_unique: { nodeType, externalKey },
      },
      select: { id: true },
    });
    return node?.id ?? null;
  }

  /** All edges (active by default) incident on a node. */
  async getEdgesForNode(
    nodeId: string,
    options: { includeExpired?: boolean } = {},
  ) {
    return prisma.recruiterGraphEdge.findMany({
      where: {
        OR: [{ fromNodeId: nodeId }, { toNodeId: nodeId }],
        ...(options.includeExpired ? {} : { validTo: null }),
      },
      orderBy: { confidence: 'desc' },
    });
  }

  /**
   * Return all nodes reachable from the recruiter node in one hop.
   * Traverses active edges only.
   */
  async getNeighbors(nodeId: string): Promise<Array<{ nodeId: string; relationshipType: string; direction: 'out' | 'in' }>> {
    const edges = await prisma.recruiterGraphEdge.findMany({
      where: {
        OR: [{ fromNodeId: nodeId }, { toNodeId: nodeId }],
        validTo: null,
      },
    });

    return edges.map((e) => ({
      nodeId: e.fromNodeId === nodeId ? e.toNodeId : e.fromNodeId,
      relationshipType: e.relationshipType,
      direction: e.fromNodeId === nodeId ? 'out' : 'in',
    }));
  }

  /**
   * Point-in-time graph snapshot — returns edges active at `asOf`
   * and their referenced nodes.
   */
  async reconstruct(asOf: Date) {
    const edges = await prisma.recruiterGraphEdge.findMany({
      where: {
        validFrom: { lte: asOf },
        OR: [{ validTo: null }, { validTo: { gt: asOf } }],
      },
    });

    const nodeIds = new Set(edges.flatMap((e) => [e.fromNodeId, e.toNodeId]));

    const nodes = nodeIds.size > 0
      ? await prisma.recruiterGraphNode.findMany({
          where: { id: { in: [...nodeIds] } },
        })
      : [];

    return { nodes, edges };
  }

  /**
   * Structural integrity check.
   * Verifies every edge's fromNodeId and toNodeId exist and confidence is [0,1].
   */
  async validate(): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];

    const edges = await prisma.recruiterGraphEdge.findMany({ where: { validTo: null } });
    const nodeIds = new Set(
      (await prisma.recruiterGraphNode.findMany({ select: { id: true } })).map((n) => n.id),
    );

    for (const edge of edges) {
      if (!nodeIds.has(edge.fromNodeId)) {
        errors.push(`Edge ${edge.id}: missing from-node ${edge.fromNodeId}`);
      }
      if (!nodeIds.has(edge.toNodeId)) {
        errors.push(`Edge ${edge.id}: missing to-node ${edge.toNodeId}`);
      }
      if (edge.confidence < 0 || edge.confidence > 1) {
        errors.push(`Edge ${edge.id}: invalid confidence ${edge.confidence}`);
      }
      if (edge.validTo && edge.validTo <= edge.validFrom) {
        errors.push(`Edge ${edge.id}: validTo must be after validFrom`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /** Node + edge counts for monitoring. */
  async stats() {
    const [nodeCount, edgeCount, activeEdgeCount] = await Promise.all([
      prisma.recruiterGraphNode.count(),
      prisma.recruiterGraphEdge.count(),
      prisma.recruiterGraphEdge.count({ where: { validTo: null } }),
    ]);
    return { nodeCount, edgeCount, activeEdgeCount };
  }
}

export const recruiterKnowledgeGraphService = new RecruiterKnowledgeGraphService();
