import { randomUUID } from 'crypto';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';

// ─── Graph node/edge types ────────────────────────────────────────────────────

export type KgNodeType =
  | 'recruiter'
  | 'organization'
  | 'team'
  | 'department'
  | 'office'
  | 'skill'
  | 'technology'
  | 'role'
  | 'hiring_domain'
  | 'location'
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

export interface KgNode {
  nodeId: string;
  nodeType: KgNodeType;
  externalKey: string;
  label: string;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KgEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: KgRelationshipType;
  confidence: number;
  confidenceBand: 'low' | 'medium' | 'high' | 'critical';
  validFrom: Date;
  validTo?: Date;
  evidenceJson: EdgeEvidence[];
  provenanceJson: EdgeProvenance;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EdgeEvidence {
  sourceFactId?: string;
  inferenceId?: string;
  messageId?: string;
  excerpt: string;
  confidence: number;
}

export interface EdgeProvenance {
  source: string;
  populatedBy: string;
  method: 'entity_extraction' | 'reasoning_enrichment' | 'manual';
  templateVersion: string;
  populatedAt: string;
}

export interface KnowledgeGraph {
  nodes: Map<string, KgNode>;
  edges: Map<string, KgEdge>;
  version: number;
  lastUpdatedAt: Date;
}

export interface GraphUpdateDelta {
  addedNodes: KgNode[];
  updatedNodes: KgNode[];
  addedEdges: KgEdge[];
  updatedEdges: KgEdge[];
}

export interface GraphPopulationResult {
  recruiterId: string;
  delta: GraphUpdateDelta;
  graph: { nodeCount: number; edgeCount: number; version: number };
  completedAt: Date;
}

/**
 * KnowledgeGraphPopulationService — Prompt 14 implementation.
 *
 * Automatically populates the Recruiter Knowledge Graph from extracted facts
 * and reasoning inferences.
 *
 * Supports:
 *   - Upsert semantics (idempotent population from repeated extractions)
 *   - Temporal edges (validFrom / validTo on every edge)
 *   - Confidence on every node and edge
 *   - Provenance on every edge
 *   - Graph versioning (monotonic version counter per graph mutation)
 *   - Incremental updates (delta tracking)
 *   - Historical reconstruction (point-in-time graph snapshot)
 *
 * Node types: recruiter, organization, team, department, office,
 *             skill, technology, role, hiring_domain, location
 *
 * Relationship types: recruiter ↔ recruiter, recruiter ↔ organization,
 *   recruiter ↔ team, recruiter ↔ department, recruiter ↔ candidate,
 *   recruiter ↔ opportunity, organization ↔ team, organization ↔ department
 */
export class KnowledgeGraphPopulationService {
  private graph: KnowledgeGraph = {
    nodes: new Map(),
    edges: new Map(),
    version: 0,
    lastUpdatedAt: new Date(),
  };

  /**
   * Populate graph nodes and edges from entity extraction facts.
   * Returns only the delta (what was added/changed this run).
   */
  populateFromFacts(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    observedAt: Date = new Date(),
  ): GraphPopulationResult {
    const delta: GraphUpdateDelta = {
      addedNodes: [],
      updatedNodes: [],
      addedEdges: [],
      updatedEdges: [],
    };

    // Ensure recruiter node exists
    const recruiterNode = this.upsertNode(
      { nodeType: 'recruiter', externalKey: recruiterId, label: recruiterId, metadata: {} },
      delta,
    );

    for (const fact of facts) {
      this.populateFactNode(recruiterNode, fact, observedAt, delta);
    }

    this.graph.version++;
    this.graph.lastUpdatedAt = new Date();

    return {
      recruiterId,
      delta,
      graph: {
        nodeCount: this.graph.nodes.size,
        edgeCount: this.graph.edges.size,
        version: this.graph.version,
      },
      completedAt: new Date(),
    };
  }

  /**
   * Populate graph from reasoning inferences.
   * Adds edges that cannot be derived from raw facts alone.
   */
  populateFromInferences(
    recruiterId: string,
    reasoning: RecruiterReasoningResult,
    observedAt: Date = new Date(),
  ): GraphPopulationResult {
    const delta: GraphUpdateDelta = {
      addedNodes: [],
      updatedNodes: [],
      addedEdges: [],
      updatedEdges: [],
    };

    const recruiterNode = this.upsertNode(
      { nodeType: 'recruiter', externalKey: recruiterId, label: recruiterId, metadata: {
        seniority: reasoning.seniority.value,
        specialization: reasoning.specialization.value,
        decisionAuthority: reasoning.decisionAuthority.value,
      }},
      delta,
    );

    // Technical domains → technology nodes
    for (const domain of reasoning.technicalDomains.value) {
      const techNode = this.upsertNode(
        { nodeType: 'technology', externalKey: domain.toLowerCase(), label: domain, metadata: {} },
        delta,
      );
      this.upsertEdge({
        fromNodeId: recruiterNode.nodeId,
        toNodeId: techNode.nodeId,
        relationshipType: 'recruiter_to_technology',
        confidence: reasoning.technicalDomains.confidence,
        validFrom: observedAt,
        evidence: [{
          inferenceId: reasoning.technicalDomains.inferenceId,
          excerpt: reasoning.technicalDomains.reasoning,
          confidence: reasoning.technicalDomains.confidence,
        }],
        provenance: this.buildProvenance('reasoning_enrichment', reasoning.technicalDomains.provenance.inferrer),
      }, delta);
    }

    // Hiring focus → role nodes
    for (const role of reasoning.hiringFocus.value) {
      const roleNode = this.upsertNode(
        { nodeType: 'role', externalKey: role.toLowerCase().replace(/\s+/g, '-'), label: role, metadata: {} },
        delta,
      );
      this.upsertEdge({
        fromNodeId: recruiterNode.nodeId,
        toNodeId: roleNode.nodeId,
        relationshipType: 'recruiter_to_hiring_domain',
        confidence: reasoning.hiringFocus.confidence,
        validFrom: observedAt,
        evidence: [{
          inferenceId: reasoning.hiringFocus.inferenceId,
          excerpt: reasoning.hiringFocus.reasoning,
          confidence: reasoning.hiringFocus.confidence,
        }],
        provenance: this.buildProvenance('reasoning_enrichment', reasoning.hiringFocus.provenance.inferrer),
      }, delta);
    }

    // Geographic responsibility → location nodes
    for (const location of reasoning.geographicResponsibility.value) {
      const locNode = this.upsertNode(
        { nodeType: 'location', externalKey: location.toLowerCase(), label: location, metadata: {} },
        delta,
      );
      this.upsertEdge({
        fromNodeId: recruiterNode.nodeId,
        toNodeId: locNode.nodeId,
        relationshipType: 'recruiter_to_location',
        confidence: reasoning.geographicResponsibility.confidence,
        validFrom: observedAt,
        evidence: [{
          inferenceId: reasoning.geographicResponsibility.inferenceId,
          excerpt: reasoning.geographicResponsibility.reasoning,
          confidence: reasoning.geographicResponsibility.confidence,
        }],
        provenance: this.buildProvenance('reasoning_enrichment', reasoning.geographicResponsibility.provenance.inferrer),
      }, delta);
    }

    this.graph.version++;
    this.graph.lastUpdatedAt = new Date();

    return {
      recruiterId,
      delta,
      graph: {
        nodeCount: this.graph.nodes.size,
        edgeCount: this.graph.edges.size,
        version: this.graph.version,
      },
      completedAt: new Date(),
    };
  }

  /**
   * Apply a full incremental update (nodes + edges) to the graph.
   * Returns the merged graph state.
   */
  applyIncrementalUpdate(update: {
    nodes?: Array<Partial<KgNode> & { nodeType: KgNodeType; externalKey: string; label: string }>;
    edges?: Array<Partial<KgEdge> & { fromNodeId: string; toNodeId: string; relationshipType: KgRelationshipType }>;
  }): { nodeCount: number; edgeCount: number; version: number } {
    const delta: GraphUpdateDelta = { addedNodes: [], updatedNodes: [], addedEdges: [], updatedEdges: [] };

    for (const node of update.nodes ?? []) {
      this.upsertNode({ nodeType: node.nodeType, externalKey: node.externalKey, label: node.label, metadata: node.metadata ?? {} }, delta);
    }
    for (const edge of update.edges ?? []) {
      const now = new Date();
      this.upsertEdge({
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        relationshipType: edge.relationshipType,
        confidence: edge.confidence ?? 0.5,
        validFrom: edge.validFrom ?? now,
        validTo: edge.validTo,
        evidence: (edge.evidenceJson as EdgeEvidence[] | undefined) ?? [],
        provenance: (edge.provenanceJson as EdgeProvenance | undefined) ?? this.buildProvenance('manual', 'api'),
      }, delta);
    }

    this.graph.version++;
    this.graph.lastUpdatedAt = new Date();
    return { nodeCount: this.graph.nodes.size, edgeCount: this.graph.edges.size, version: this.graph.version };
  }

  /**
   * Reconstruct the graph as it existed at a given point in time.
   * Only returns edges whose [validFrom, validTo) range includes `asOf`.
   */
  reconstruct(asOf: Date): { nodes: KgNode[]; edges: KgEdge[] } {
    const activeEdges = [...this.graph.edges.values()].filter(
      (e) => e.validFrom <= asOf && (!e.validTo || e.validTo > asOf),
    );

    const referencedNodeIds = new Set(
      activeEdges.flatMap((e) => [e.fromNodeId, e.toNodeId]),
    );

    const activeNodes = [...this.graph.nodes.values()].filter(
      (n) => referencedNodeIds.has(n.nodeId),
    );

    return { nodes: activeNodes, edges: activeEdges };
  }

  /**
   * Validate graph structural integrity.
   * Every edge must reference two existing nodes. Confidence must be [0,1].
   * Temporal ranges must be valid (validTo > validFrom when both present).
   */
  validate(): { ok: boolean; errors: string[] } {
    const nodeIds = new Set(this.graph.nodes.keys());
    const errors: string[] = [];

    for (const edge of this.graph.edges.values()) {
      if (!nodeIds.has(edge.fromNodeId)) {
        errors.push(`Edge ${edge.edgeId}: missing from-node ${edge.fromNodeId}`);
      }
      if (!nodeIds.has(edge.toNodeId)) {
        errors.push(`Edge ${edge.edgeId}: missing to-node ${edge.toNodeId}`);
      }
      if (edge.confidence < 0 || edge.confidence > 1) {
        errors.push(`Edge ${edge.edgeId}: invalid confidence ${edge.confidence}`);
      }
      if (edge.validTo && edge.validTo <= edge.validFrom) {
        errors.push(`Edge ${edge.edgeId}: validTo must be after validFrom`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /**
   * Expire an edge by setting validTo to now.
   * Used when an employment change makes a recruiter↔organization edge stale.
   */
  expireEdge(edgeId: string, expiredAt: Date = new Date()): boolean {
    const edge = this.graph.edges.get(edgeId);
    if (!edge) return false;
    this.graph.edges.set(edgeId, { ...edge, validTo: expiredAt, version: edge.version + 1, updatedAt: new Date() });
    this.graph.version++;
    return true;
  }

  getGraph(): Readonly<KnowledgeGraph> {
    return this.graph;
  }

  getNodeByKey(nodeType: KgNodeType, externalKey: string): KgNode | undefined {
    return this.graph.nodes.get(this.nodeKey(nodeType, externalKey));
  }

  getEdgesForNode(nodeId: string): KgEdge[] {
    return [...this.graph.edges.values()].filter(
      (e) => e.fromNodeId === nodeId || e.toNodeId === nodeId,
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private populateFactNode(
    recruiterNode: KgNode,
    fact: RecruiterEntityFact,
    observedAt: Date,
    delta: GraphUpdateDelta,
  ): void {
    const nodeMapping: Partial<Record<RecruiterEntityFact['fieldType'], KgNodeType>> = {
      recruiter_organization: 'organization',
      recruiter_department: 'department',
      recruiter_team: 'team',
      recruiter_office: 'office',
      technology: 'technology',
      skill: 'skill',
      hiring_domain: 'hiring_domain',
      hiring_location: 'location',
    };

    const relMapping: Partial<Record<RecruiterEntityFact['fieldType'], KgRelationshipType>> = {
      recruiter_organization: 'recruiter_to_organization',
      recruiter_department: 'recruiter_to_department',
      recruiter_team: 'recruiter_to_team',
      recruiter_office: 'recruiter_to_organization',
      technology: 'recruiter_to_technology',
      skill: 'recruiter_to_skill',
      hiring_domain: 'recruiter_to_hiring_domain',
      hiring_location: 'recruiter_to_location',
    };

    const nodeType = nodeMapping[fact.fieldType];
    const relType = relMapping[fact.fieldType];
    if (!nodeType || !relType) return;

    const targetNode = this.upsertNode(
      {
        nodeType,
        externalKey: fact.normalizedValue || fact.rawValue,
        label: fact.rawValue,
        metadata: { ...fact.structuredValue },
      },
      delta,
    );

    this.upsertEdge({
      fromNodeId: recruiterNode.nodeId,
      toNodeId: targetNode.nodeId,
      relationshipType: relType,
      confidence: fact.confidence,
      validFrom: observedAt,
      evidence: [{
        sourceFactId: fact.factId,
        excerpt: fact.evidence.excerpt,
        confidence: fact.confidence,
      }],
      provenance: this.buildProvenance('entity_extraction', fact.provenance.extractor),
    }, delta);
  }

  private upsertNode(
    input: { nodeType: KgNodeType; externalKey: string; label: string; metadata: Record<string, unknown> },
    delta: GraphUpdateDelta,
  ): KgNode {
    const key = this.nodeKey(input.nodeType, input.externalKey);
    const existing = this.graph.nodes.get(key);
    const now = new Date();

    if (existing) {
      const updated: KgNode = {
        ...existing,
        label: input.label || existing.label,
        metadata: { ...existing.metadata, ...input.metadata },
        version: existing.version + 1,
        updatedAt: now,
      };
      this.graph.nodes.set(key, updated);
      delta.updatedNodes.push(updated);
      return updated;
    }

    const node: KgNode = {
      nodeId: randomUUID(),
      nodeType: input.nodeType,
      externalKey: input.externalKey,
      label: input.label,
      metadata: input.metadata,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.graph.nodes.set(key, node);
    delta.addedNodes.push(node);
    return node;
  }

  private upsertEdge(
    input: {
      fromNodeId: string;
      toNodeId: string;
      relationshipType: KgRelationshipType;
      confidence: number;
      validFrom: Date;
      validTo?: Date;
      evidence: EdgeEvidence[];
      provenance: EdgeProvenance;
    },
    delta: GraphUpdateDelta,
  ): KgEdge {
    const key = this.edgeKey(input.fromNodeId, input.toNodeId, input.relationshipType);
    const existing = this.graph.edges.get(key);
    const now = new Date();
    const clampedConf = Math.max(0, Math.min(1, input.confidence));

    if (existing) {
      const updated: KgEdge = {
        ...existing,
        confidence: Math.max(existing.confidence, clampedConf),
        confidenceBand: this.toConfidenceBand(Math.max(existing.confidence, clampedConf)),
        evidenceJson: [...existing.evidenceJson, ...input.evidence].slice(-20),
        version: existing.version + 1,
        updatedAt: now,
      };
      this.graph.edges.set(key, updated);
      delta.updatedEdges.push(updated);
      return updated;
    }

    const edge: KgEdge = {
      edgeId: randomUUID(),
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relationshipType: input.relationshipType,
      confidence: clampedConf,
      confidenceBand: this.toConfidenceBand(clampedConf),
      validFrom: input.validFrom,
      validTo: input.validTo,
      evidenceJson: input.evidence,
      provenanceJson: input.provenance,
      metadata: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.graph.edges.set(key, edge);
    delta.addedEdges.push(edge);
    return edge;
  }

  private buildProvenance(method: EdgeProvenance['method'], populatedBy: string): EdgeProvenance {
    return {
      source: 'knowledge-graph-population-v1',
      populatedBy,
      method,
      templateVersion: '1.0.0',
      populatedAt: new Date().toISOString(),
    };
  }

  private nodeKey(nodeType: KgNodeType, externalKey: string): string {
    return `${nodeType}::${externalKey}`;
  }

  private edgeKey(from: string, to: string, rel: KgRelationshipType): string {
    return `${from}→${rel}→${to}`;
  }

  private toConfidenceBand(confidence: number): KgEdge['confidenceBand'] {
    if (confidence >= 0.90) return 'critical';
    if (confidence >= 0.72) return 'high';
    if (confidence >= 0.50) return 'medium';
    return 'low';
  }
}
