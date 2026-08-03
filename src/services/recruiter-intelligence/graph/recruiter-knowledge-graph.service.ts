export type RecruiterGraphNodeType =
  | 'recruiter'
  | 'organization'
  | 'team'
  | 'department'
  | 'office'
  | 'role'
  | 'skill'
  | 'technology'
  | 'location';

export interface RecruiterGraphNode {
  id: string;
  type: RecruiterGraphNodeType;
  label: string;
  metadata?: Record<string, unknown>;
  version: number;
}

export interface RecruiterGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  confidence: number;
  evidence: Record<string, unknown>[];
  provenance: Record<string, unknown>;
  validFrom: Date;
  validTo?: Date;
  version: number;
}

export class RecruiterKnowledgeGraphService {
  applyIncrementalUpdate(
    graph: { nodes: RecruiterGraphNode[]; edges: RecruiterGraphEdge[] },
    update: { nodes?: RecruiterGraphNode[]; edges?: RecruiterGraphEdge[] },
  ) {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
    for (const node of update.nodes ?? [])
      nodes.set(node.id, {
        ...nodes.get(node.id),
        ...node,
        version: (nodes.get(node.id)?.version ?? 0) + 1,
      });
    for (const edge of update.edges ?? [])
      edges.set(edge.id, {
        ...edges.get(edge.id),
        ...edge,
        confidence: Math.max(0, Math.min(1, edge.confidence)),
        version: (edges.get(edge.id)?.version ?? 0) + 1,
      });
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  validate(graph: { nodes: RecruiterGraphNode[]; edges: RecruiterGraphEdge[] }): {
    ok: boolean;
    errors: string[];
  } {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const errors = graph.edges.flatMap((edge) => [
      ...(!nodeIds.has(edge.fromNodeId) ? [`Missing from-node ${edge.fromNodeId}`] : []),
      ...(!nodeIds.has(edge.toNodeId) ? [`Missing to-node ${edge.toNodeId}`] : []),
      ...(edge.confidence < 0 || edge.confidence > 1
        ? [`Invalid confidence for edge ${edge.id}`]
        : []),
      ...(edge.validTo && edge.validTo <= edge.validFrom
        ? [`Invalid temporal range for edge ${edge.id}`]
        : []),
    ]);
    return { ok: errors.length === 0, errors };
  }

  reconstruct(graph: { nodes: RecruiterGraphNode[]; edges: RecruiterGraphEdge[] }, asOf: Date) {
    return {
      nodes: graph.nodes,
      edges: graph.edges.filter(
        (edge) => edge.validFrom <= asOf && (!edge.validTo || edge.validTo > asOf),
      ),
    };
  }
}
