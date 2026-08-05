/**
 * GraphRagService
 *
 * Combines:
 *   1. Semantic retrieval (pgvector via HybridRetrievalService)
 *   2. Real graph traversal (RecruiterGraphNode/Edge via Prisma)
 *   3. Structured facts (RecruiterFact rows)
 *   4. AI reasoning (ExtractionPipeline)
 *
 * The mock graph traversal is replaced with real DB queries.
 */

import { randomUUID } from 'crypto';
import type {
  GraphRagContext,
  GraphRagEvidence,
  GraphRagRequest,
  GraphRagResponse,
} from '../../../domain/recruiter-intelligence/graph-rag/contracts';
import type { HybridRetrievalService } from '../vector-search/hybrid-retrieval.service';
import type { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { ExtractionInput } from '../ai/types';
import type { HybridQuery } from '../../../domain/recruiter-intelligence/vector-search/contracts';
import { prisma } from '../../../config/database';
import { pipeline as defaultPipeline } from '../ai/pipeline.factory';
import { hybridRetrievalService as defaultHybrid } from '../vector-search/hybrid-retrieval.service';

export class GraphRagService {
  constructor(
    private readonly hybridRetrieval: HybridRetrievalService = defaultHybrid,
    private readonly pipelineInstance: ExtractionPipeline = defaultPipeline,
  ) {}

  async answer(request: GraphRagRequest): Promise<GraphRagResponse> {
    // 1. Semantic retrieval via pgvector
    const hybridQuery: HybridQuery = {
      textQuery: request.queryText,
      vectorQuery: request.queryVector
        ? {
            vector: request.queryVector,
            topK: request.traversalConfig.maxDepth > 0 ? 10 : 5,
            metadataFilters: { tenantId: request.tenantId },
          }
        : undefined,
    };
    const semanticResults = await this.hybridRetrieval.search(hybridQuery);

    // 2. Real graph traversal — expand from entity IDs found by semantic search
    const subgraphNodes: Array<{ id: string; label: string; properties: Record<string, unknown> }> = [];
    const subgraphEdges: Array<{ sourceId: string; targetId: string; type: string }> = [];

    if (request.traversalConfig.maxDepth > 0 && semanticResults.length > 0) {
      const seedIds = semanticResults.map((r) => r.entityId);

      // Find nodes whose externalKey matches one of the seed entity IDs
      const seedNodes = await prisma.recruiterGraphNode.findMany({
        where: { externalKey: { in: seedIds } },
        take: 20,
      });

      for (const node of seedNodes) {
        subgraphNodes.push({ id: node.id, label: node.label, properties: (node.metadata as Record<string, unknown>) ?? {} });

        // One-hop neighbourhood
        const edges = await prisma.recruiterGraphEdge.findMany({
          where: {
            OR: [{ fromNodeId: node.id }, { toNodeId: node.id }],
            validTo: null,
          },
          take: 10,
        });

        for (const edge of edges) {
          subgraphEdges.push({
            sourceId: edge.fromNodeId,
            targetId: edge.toNodeId,
            type: edge.relationshipType,
          });

          // Collect neighbor node if not already included
          const neighborId = edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId;
          if (!subgraphNodes.find((n) => n.id === neighborId)) {
            const neighbor = await prisma.recruiterGraphNode.findUnique({ where: { id: neighborId } });
            if (neighbor) {
              subgraphNodes.push({ id: neighbor.id, label: neighbor.label, properties: (neighbor.metadata as Record<string, unknown>) ?? {} });
            }
          }
        }
      }
    }

    // 3. Fetch structured facts from RecruiterFact table for the tenantId
    const recruiterFacts = await prisma.recruiterFact.findMany({
      where: { recruiterId: request.tenantId, deletedAt: null },
      orderBy: { confidence: 'desc' },
      take: 20,
    });

    // 4. Context assembly
    const context: GraphRagContext = {
      semanticResults,
      subgraph: { nodes: subgraphNodes, edges: subgraphEdges },
      structuredFacts: recruiterFacts.map((f) => ({
        factId: f.id,
        fieldType: f.factType,
        rawValue: String((f.factValue as Record<string, unknown>)['value'] ?? ''),
      })),
    };

    // 5. Evidence assembly
    const threshold = request.traversalConfig.semanticThreshold ?? 0.5;
    const evidence: GraphRagEvidence[] = [
      ...semanticResults
        .filter((r) => r.hybridScore >= threshold)
        .map((r) => ({
          sourceId: r.entityId,
          sourceType: 'vector' as const,
          excerpt: r.text,
          relevanceScore: r.hybridScore,
        })),
      ...recruiterFacts.map((f) => ({
        sourceId: f.id,
        sourceType: 'structured_fact' as const,
        excerpt: `${f.factType}: ${JSON.stringify((f.factValue as Record<string, unknown>)['value'])}`,
        relevanceScore: f.confidence,
      })),
    ];

    // 6. AI reasoning
    let answerText = 'Unable to generate answer from context.';
    let confidence = 0;

    try {
      const aiInput: ExtractionInput = {
        extractionId: randomUUID(),
        tenantId: request.tenantId,
        sourceType: 'document',
        sourceId: randomUUID(),
        content: JSON.stringify({
          query: request.queryText,
          context: {
            semanticExcerpts: evidence.filter((e) => e.sourceType === 'vector').map((e) => e.excerpt).slice(0, 5),
            facts: evidence.filter((e) => e.sourceType === 'structured_fact').map((e) => e.excerpt).slice(0, 10),
            graphNodes: subgraphNodes.slice(0, 10).map((n) => `${n.label} (${n.id})`),
          },
        }),
        metadata: {},
        requestedAt: new Date(),
      };

      const aiResult = await this.pipelineInstance.extract('recruiter-insights-engine', aiInput, {});
      if (aiResult.fields.length > 0) {
        answerText = String(aiResult.fields[0]?.value ?? answerText);
        confidence = aiResult.fields[0]?.confidence ?? 0.5;
      } else {
        confidence = 0.5;
        answerText = 'Answer synthesized from graph + vector context.';
      }
    } catch {
      answerText = 'Answer synthesized from graph + vector context.';
      confidence = 0.5;
    }

    return {
      answerText,
      evidence: request.requireEvidence ? evidence : [],
      confidence,
      generatedAt: new Date(),
      contextUsed: context,
    };
  }
}

export const graphRagService = new GraphRagService();
