/**
 * RecruiterIntelligenceConnectorService
 *
 * Finishes connecting the identity/behavioral/communication layers to the
 * graph (Wave 2 Step 6) and memory (Wave 2 Step 7) services.
 *
 * This is the "glue" layer — it does not replace the existing extraction or
 * behavioral services; it wires their outputs to persistent storage:
 *
 *   1. After extraction:   facts → RecruiterMemoryObservation (via memory service)
 *   2. After extraction:   facts → RecruiterGraphNode/Edge (via graph service)
 *   3. After communication: message → RecruiterFact (via capability base)
 *   4. Planner entry point for all recruiter intelligence requests
 *
 * Callers (routes, workers) should use this service rather than calling the
 * sub-services directly.
 */

import { recruiterMemoryService } from './memory/recruiter-memory.service';
import { knowledgeGraphPopulationService } from './graph/knowledge-graph-population.service';
import { planner } from '../planner';
import type { RecruiterEntityFact } from './extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from './reasoning/recruiter-reasoning-enrichment.service';

export interface RecruiterIntelligenceInput {
  recruiterId: string;
  userId: string;
  /** Raw communication text (email subject + body) */
  communicationText: string;
  /** Pre-extracted facts (optional — if already extracted upstream) */
  facts?: RecruiterEntityFact[];
  /** Pre-computed reasoning (optional) */
  reasoning?: RecruiterReasoningResult;
}

export interface RecruiterIntelligenceOutput {
  planId: string;
  memoryObservationIds: string[];
  graphNodeIds: string[];
  graphEdgeIds: string[];
  capabilityFields: Array<{ name: string; value: unknown; confidence: number }>;
  latencyMs: number;
}

export class RecruiterIntelligenceConnectorService {
  /**
   * Full pipeline: extract → persist memory → persist graph → run capabilities.
   */
  async process(input: RecruiterIntelligenceInput): Promise<RecruiterIntelligenceOutput> {
    const start = Date.now();

    // 1. Run planner(infer) — extract + infer from communication text
    //    Writes RecruiterFact rows (via capability.base) automatically
    const planResult = await planner.run({
      userId: input.userId,
      entityId: input.recruiterId,
      entityType: 'recruiter',
      content: input.communicationText,
      intent: 'infer',
      plannerContext: { recruiterId: input.recruiterId, source: 'communication' },
    });

    // 2. Persist extracted fields to RecruiterMemoryObservation
    const memoryObservationIds: string[] = [];
    for (const capResult of planResult.results) {
      for (const field of capResult.fields) {
        if (field.confidence < 0.4) continue;
        try {
          const obs = await recruiterMemoryService.write({
            recruiterId: input.recruiterId,
            factType: `communication.${field.name}`,
            factValue: { value: field.value, evidence: field.evidence },
            confidence: field.confidence,
            validFrom: new Date(),
            provenanceJson: { planId: planResult.planId, capability: capResult.capability },
            evidenceJson: [{ excerpt: field.evidence }],
          });
          memoryObservationIds.push(obs.id);
        } catch {
          // Non-fatal
        }
      }
    }

    // 3. If pre-extracted facts are provided, also populate the graph
    const graphNodeIds: string[] = [];
    const graphEdgeIds: string[] = [];

    if (input.facts && input.facts.length > 0) {
      try {
        const graphResult = await knowledgeGraphPopulationService.populateFromFacts(
          input.recruiterId,
          input.facts,
        );
        graphNodeIds.push(...graphResult.addedNodeIds);
        graphEdgeIds.push(...graphResult.addedEdgeIds);
      } catch {
        // Non-fatal — graph population failure doesn't break the pipeline
      }
    }

    if (input.reasoning) {
      try {
        const graphResult = await knowledgeGraphPopulationService.populateFromInferences(
          input.recruiterId,
          input.reasoning,
        );
        graphNodeIds.push(...graphResult.addedNodeIds);
        graphEdgeIds.push(...graphResult.addedEdgeIds);
      } catch {
        // Non-fatal
      }
    }

    return {
      planId: planResult.planId,
      memoryObservationIds,
      graphNodeIds,
      graphEdgeIds,
      capabilityFields: planResult.results.flatMap((r) =>
        r.fields.map((f) => ({ name: f.name, value: f.value, confidence: f.confidence })),
      ),
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Read current memory state for a recruiter.
   * Used by the career intelligence entry point (Wave 6 Step 20).
   */
  async readMemory(recruiterId: string, factType?: string) {
    return recruiterMemoryService.read(recruiterId, { factType });
  }

  /**
   * Read the current graph neighborhood for a recruiter.
   */
  async readGraph(recruiterId: string) {
    const { recruiterKnowledgeGraphService } = await import('./graph/recruiter-knowledge-graph.service');
    const nodeId = await recruiterKnowledgeGraphService.findNodeId('recruiter', recruiterId);
    if (!nodeId) return { nodeId: null, neighbors: [] };
    const neighbors = await recruiterKnowledgeGraphService.getNeighbors(nodeId);
    return { nodeId, neighbors };
  }
}

export const recruiterIntelligenceConnectorService = new RecruiterIntelligenceConnectorService();
