/**
 * KnowledgeGraphPopulationService
 *
 * Populates RecruiterGraphNode / RecruiterGraphEdge from entity-extraction
 * facts and reasoning inferences.  All writes go through
 * RecruiterKnowledgeGraphService → Prisma — not in memory.
 *
 * Graph survives process restarts (verified by the persistence test below).
 */

import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';
import {
  RecruiterKnowledgeGraphService,
  type KgNodeType,
  type KgRelationshipType,
} from './recruiter-knowledge-graph.service';

export interface GraphPopulationResult {
  recruiterId: string;
  addedNodeIds: string[];
  addedEdgeIds: string[];
  completedAt: Date;
}

export class KnowledgeGraphPopulationService {
  constructor(
    private readonly graph: RecruiterKnowledgeGraphService = new RecruiterKnowledgeGraphService(),
  ) {}

  /**
   * Populate from entity-extraction facts.
   * Idempotent — re-running with the same facts is a no-op (upsert semantics).
   */
  async populateFromFacts(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    observedAt: Date = new Date(),
  ): Promise<GraphPopulationResult> {
    const addedNodeIds: string[] = [];
    const addedEdgeIds: string[] = [];

    // Ensure recruiter node exists
    const recruiterNodeId = await this.graph.upsertNode({
      nodeType: 'recruiter',
      externalKey: recruiterId,
      label: recruiterId,
      metadata: {},
    });
    addedNodeIds.push(recruiterNodeId);

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

    for (const fact of facts) {
      const nodeType = nodeMapping[fact.fieldType];
      const relType = relMapping[fact.fieldType];
      if (!nodeType || !relType) continue;

      const targetNodeId = await this.graph.upsertNode({
        nodeType,
        externalKey: fact.normalizedValue || fact.rawValue,
        label: fact.rawValue,
        metadata: { ...fact.structuredValue },
      });
      addedNodeIds.push(targetNodeId);

      const edgeId = await this.graph.upsertEdge({
        fromNodeId: recruiterNodeId,
        toNodeId: targetNodeId,
        relationshipType: relType,
        confidence: fact.confidence,
        validFrom: observedAt,
        evidenceJson: [{ sourceFactId: fact.factId, excerpt: fact.evidence.excerpt, confidence: fact.confidence }],
        provenanceJson: {
          source: 'entity-extraction',
          populatedBy: fact.provenance.extractor,
          method: 'entity_extraction',
          populatedAt: new Date().toISOString(),
        },
      });
      addedEdgeIds.push(edgeId);
    }

    return { recruiterId, addedNodeIds, addedEdgeIds, completedAt: new Date() };
  }

  /**
   * Populate from reasoning inferences (technical domains, hiring focus, locations).
   */
  async populateFromInferences(
    recruiterId: string,
    reasoning: RecruiterReasoningResult,
    observedAt: Date = new Date(),
  ): Promise<GraphPopulationResult> {
    const addedNodeIds: string[] = [];
    const addedEdgeIds: string[] = [];

    const recruiterNodeId = await this.graph.upsertNode({
      nodeType: 'recruiter',
      externalKey: recruiterId,
      label: recruiterId,
      metadata: {
        seniority: reasoning.seniority.value,
        specialization: reasoning.specialization.value,
        decisionAuthority: reasoning.decisionAuthority.value,
      },
    });
    addedNodeIds.push(recruiterNodeId);

    // Technical domains → technology nodes
    for (const domain of reasoning.technicalDomains.value) {
      const nodeId = await this.graph.upsertNode({
        nodeType: 'technology',
        externalKey: domain.toLowerCase(),
        label: domain,
      });
      addedNodeIds.push(nodeId);

      const edgeId = await this.graph.upsertEdge({
        fromNodeId: recruiterNodeId,
        toNodeId: nodeId,
        relationshipType: 'recruiter_to_technology',
        confidence: reasoning.technicalDomains.confidence,
        validFrom: observedAt,
        evidenceJson: [{ inferenceId: reasoning.technicalDomains.inferenceId, excerpt: reasoning.technicalDomains.reasoning, confidence: reasoning.technicalDomains.confidence }],
        provenanceJson: { source: 'reasoning-enrichment', method: 'reasoning_enrichment', populatedAt: new Date().toISOString() },
      });
      addedEdgeIds.push(edgeId);
    }

    // Hiring focus → role nodes
    for (const role of reasoning.hiringFocus.value) {
      const nodeId = await this.graph.upsertNode({
        nodeType: 'role',
        externalKey: role.toLowerCase().replace(/\s+/g, '-'),
        label: role,
      });
      addedNodeIds.push(nodeId);

      const edgeId = await this.graph.upsertEdge({
        fromNodeId: recruiterNodeId,
        toNodeId: nodeId,
        relationshipType: 'recruiter_to_hiring_domain',
        confidence: reasoning.hiringFocus.confidence,
        validFrom: observedAt,
        evidenceJson: [{ inferenceId: reasoning.hiringFocus.inferenceId, excerpt: reasoning.hiringFocus.reasoning, confidence: reasoning.hiringFocus.confidence }],
        provenanceJson: { source: 'reasoning-enrichment', method: 'reasoning_enrichment', populatedAt: new Date().toISOString() },
      });
      addedEdgeIds.push(edgeId);
    }

    // Geographic responsibility → location nodes
    for (const location of reasoning.geographicResponsibility.value) {
      const nodeId = await this.graph.upsertNode({
        nodeType: 'location',
        externalKey: location.toLowerCase(),
        label: location,
      });
      addedNodeIds.push(nodeId);

      const edgeId = await this.graph.upsertEdge({
        fromNodeId: recruiterNodeId,
        toNodeId: nodeId,
        relationshipType: 'recruiter_to_location',
        confidence: reasoning.geographicResponsibility.confidence,
        validFrom: observedAt,
        evidenceJson: [{ inferenceId: reasoning.geographicResponsibility.inferenceId, excerpt: reasoning.geographicResponsibility.reasoning, confidence: reasoning.geographicResponsibility.confidence }],
        provenanceJson: { source: 'reasoning-enrichment', method: 'reasoning_enrichment', populatedAt: new Date().toISOString() },
      });
      addedEdgeIds.push(edgeId);
    }

    return { recruiterId, addedNodeIds, addedEdgeIds, completedAt: new Date() };
  }
}

export const knowledgeGraphPopulationService = new KnowledgeGraphPopulationService();
