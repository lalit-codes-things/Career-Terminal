import { randomUUID } from 'crypto';
import type {
  CrossEpicIntelligenceBundle,
  CrossEpicIntelligenceLink,
  CrossEpicIntelligenceMessage,
  CrossEpicQuery,
  CrossEpicQueryResult,
  CrossEpicIntegrationConfig,
  EpicId,
  IntelligenceDomain,
} from '../../domain/recruiter-intelligence/cross-epic/contracts';

export interface IntelligenceBrokerConfig {
  maxHops: number;
  enableGraphRagEnrichment: boolean;
  enableSemanticEnrichment: boolean;
  enableMemoryEnrichment: boolean;
  enableTimelineEnrichment: boolean;
  enableProvenanceChaining: boolean;
  confidenceDecayPerHop: number;
  maxContextTokens: number;
}

const DEFAULT_BROKER_CONFIG: IntelligenceBrokerConfig = {
  maxHops: 3,
  enableGraphRagEnrichment: true,
  enableSemanticEnrichment: true,
  enableMemoryEnrichment: true,
  enableTimelineEnrichment: true,
  enableProvenanceChaining: true,
  confidenceDecayPerHop: 0.15,
  maxContextTokens: 8000,
};

export interface BrokerResult {
  query: CrossEpicQuery;
  enrichedIntelligence: CrossEpicIntelligenceLink[];
  contextAssembly: {
    semanticExcerpts: string[];
    graphTraversalPaths: string[];
    memorySnapshots: string[];
    timelineEvents: string[];
    structuredFacts: string[];
  };
  overallConfidence: number;
  explainabilityChain: ExplainabilityStep[];
  completedAt: Date;
}

export interface ExplainabilityStep {
  stepId: string;
  hop: number;
  sourceEpic: EpicId;
  sourceEntityId: string;
  intelligenceType: string;
  confidence: number;
  reasoning: string;
  evidenceExcerpt: string;
  provenance: Record<string, unknown>;
}

export class IntelligenceBrokerService {
  private readonly config: IntelligenceBrokerConfig;

  constructor(config?: Partial<IntelligenceBrokerConfig>) {
    this.config = { ...DEFAULT_BROKER_CONFIG, ...config };
  }

  getConfig(): Readonly<IntelligenceBrokerConfig> {
    return this.config;
  }

  async broker(
    query: CrossEpicQuery,
    integrationService: {
      query: (q: CrossEpicQuery) => Promise<CrossEpicQueryResult>;
      getBundle: (epic: EpicId, entityId: string) => Promise<CrossEpicIntelligenceBundle>;
    },
  ): Promise<BrokerResult> {
    const explainabilityChain: ExplainabilityStep[] = [];

    const directResult = await integrationService.query(query);
    const enrichedLinks = [...directResult.results];

    for (const link of directResult.results) {
      explainabilityChain.push({
        stepId: randomUUID(),
        hop: 0,
        sourceEpic: link.sourceEpic,
        sourceEntityId: link.sourceEntityId,
        intelligenceType: link.intelligence as string,
        confidence: link.confidence,
        reasoning: `Direct link from ${link.sourceEpic}:${link.sourceEntityId} to ${link.targetEpic}:${link.targetEntityId} in domain ${link.domain}`,
        evidenceExcerpt: link.evidence[0]?.excerpt ?? 'No evidence excerpt available',
        provenance: {
          sourceEpic: link.sourceEpic,
          sourceEntityId: link.sourceEntityId,
          targetEpic: link.targetEpic,
          targetEntityId: link.targetEntityId,
          domain: link.domain,
          confidence: link.confidence,
        },
      });
    }

    if (this.config.enableGraphRagEnrichment && query.maxResults && enrichedLinks.length < query.maxResults) {
      const graphRagEnriched = await this.enrichViaGraphRag(query, integrationService, enrichedLinks, explainabilityChain);
      enrichedLinks.push(...graphRagEnriched);
    }

    if (this.config.enableSemanticEnrichment && query.maxResults && enrichedLinks.length < query.maxResults) {
      const semanticEnriched = await this.enrichViaSemanticSearch(query, integrationService, enrichedLinks, explainabilityChain);
      enrichedLinks.push(...semanticEnriched);
    }

    if (this.config.enableMemoryEnrichment && query.maxResults && enrichedLinks.length < query.maxResults) {
      const memoryEnriched = await this.enrichViaMemory(query, integrationService, enrichedLinks, explainabilityChain);
      enrichedLinks.push(...memoryEnriched);
    }

    if (this.config.enableTimelineEnrichment && query.maxResults && enrichedLinks.length < query.maxResults) {
      const timelineEnriched = await this.enrichViaTimeline(query, integrationService, enrichedLinks, explainabilityChain);
      enrichedLinks.push(...timelineEnriched);
    }

    const sorted = enrichedLinks.sort((a, b) => b.confidence - a.confidence);
    const limited = query.maxResults ? sorted.slice(0, query.maxResults) : sorted;

    const overallConfidence = limited.length > 0
      ? limited.reduce((s, l) => s + l.confidence, 0) / limited.length
      : 0;

    const contextAssembly = this.assembleContext(limited, directResult.messages);

    return {
      query,
      enrichedIntelligence: limited,
      contextAssembly,
      overallConfidence: Number(overallConfidence.toFixed(4)),
      explainabilityChain,
      completedAt: new Date(),
    };
  }

  private async enrichViaGraphRag(
    query: CrossEpicQuery,
    integrationService: { query: (q: CrossEpicQuery) => Promise<CrossEpicQueryResult>; getBundle: (epic: EpicId, entityId: string) => Promise<CrossEpicIntelligenceBundle> },
    existingLinks: CrossEpicIntelligenceLink[],
    chain: ExplainabilityStep[],
  ): Promise<CrossEpicIntelligenceLink[]> {
    const results: CrossEpicIntelligenceLink[] = [];
    const visited = new Set(existingLinks.map((l) => `${l.sourceEpic}:${l.sourceEntityId}->${l.targetEpic}:${l.targetEntityId}:${l.domain}`));

    for (const link of existingLinks) {
      if (results.length >= (query.maxResults ?? 100) - existingLinks.length) break;

      const bundle = await integrationService.getBundle(link.targetEpic, link.targetEntityId);
      for (const subLink of bundle.links) {
        const key = `${subLink.sourceEpic}:${subLink.sourceEntityId}->${subLink.targetEpic}:${subLink.targetEntityId}:${subLink.domain}`;
        if (visited.has(key)) continue;
        if (subLink.confidence < this.config.confidenceDecayPerHop) continue;

        const decayedConfidence = Number((subLink.confidence * (1 - this.config.confidenceDecayPerHop)).toFixed(4));
        if (decayedConfidence < (query.minConfidence ?? 0)) continue;

        results.push({
          ...subLink,
          confidence: decayedConfidence,
          evidence: [
            ...subLink.evidence,
            {
              evidenceId: randomUUID(),
              sourceEpic: link.sourceEpic,
              sourceEntityId: link.sourceEntityId,
              excerpt: `GraphRAG hop from ${link.sourceEpic}:${link.sourceEntityId} via ${link.domain}`,
              confidence: decayedConfidence,
              provenance: {
                extractor: 'graph-rag-enrichment',
                method: 'graph_traversal',
                sourceProvider: 'cross-epic-broker',
                extractedAt: new Date(),
                consentState: 'unknown' as const,
              },
            },
          ],
        });
        visited.add(key);

        chain.push({
          stepId: randomUUID(),
          hop: 1,
          sourceEpic: link.sourceEpic,
          sourceEntityId: link.sourceEntityId,
          intelligenceType: subLink.domain,
          confidence: decayedConfidence,
          reasoning: `GraphRAG enrichment: traversed from ${link.sourceEpic}:${link.sourceEntityId} to ${subLink.sourceEpic}:${subLink.sourceEntityId} via ${link.domain}`,
          evidenceExcerpt: subLink.evidence[0]?.excerpt ?? 'GraphRAG traversal result',
          provenance: {
            hop: 1,
            traversalType: 'graph_rag',
            intermediateEntity: `${link.targetEpic}:${link.targetEntityId}`,
          },
        });
      }
    }

    return results;
  }

  private async enrichViaSemanticSearch(
    query: CrossEpicQuery,
    integrationService: { query: (q: CrossEpicQuery) => Promise<CrossEpicQueryResult>; getBundle: (epic: EpicId, entityId: string) => Promise<CrossEpicIntelligenceBundle> },
    existingLinks: CrossEpicIntelligenceLink[],
    chain: ExplainabilityStep[],
  ): Promise<CrossEpicIntelligenceLink[]> {
    const results: CrossEpicIntelligenceLink[] = [];
    const visited = new Set(existingLinks.map((l) => `${l.sourceEpic}:${l.sourceEntityId}->${l.targetEpic}:${l.targetEntityId}:${l.domain}`));

    for (const link of existingLinks) {
      if (results.length >= (query.maxResults ?? 100) - existingLinks.length) break;

      const bundle = await integrationService.getBundle(link.targetEpic, link.targetEntityId);
      for (const subLink of bundle.links) {
        const key = `${subLink.sourceEpic}:${subLink.sourceEntityId}->${subLink.targetEpic}:${subLink.targetEntityId}:${subLink.domain}`;
        if (visited.has(key)) continue;
        if (subLink.domain !== link.domain) continue;

        const semanticConfidence = Number((subLink.confidence * 0.9).toFixed(4));
        if (semanticConfidence < (query.minConfidence ?? 0)) continue;

        results.push({
          ...subLink,
          confidence: semanticConfidence,
          evidence: [
            ...subLink.evidence,
            {
              evidenceId: randomUUID(),
              sourceEpic: link.sourceEpic,
              sourceEntityId: link.sourceEntityId,
              excerpt: `Semantic match from ${link.sourceEpic}:${link.sourceEntityId} via ${link.domain}`,
              confidence: semanticConfidence,
              provenance: {
                extractor: 'semantic-enrichment',
                method: 'semantic_match',
                sourceProvider: 'cross-epic-broker',
                extractedAt: new Date(),
                consentState: 'unknown' as const,
              },
            },
          ],
        });
        visited.add(key);

        chain.push({
          stepId: randomUUID(),
          hop: 1,
          sourceEpic: link.sourceEpic,
          sourceEntityId: link.sourceEntityId,
          intelligenceType: subLink.domain,
          confidence: semanticConfidence,
          reasoning: `Semantic enrichment: matched ${subLink.domain} intelligence from ${subLink.sourceEpic}:${subLink.sourceEntityId}`,
          evidenceExcerpt: subLink.evidence[0]?.excerpt ?? 'Semantic match result',
          provenance: {
            hop: 1,
            matchType: 'semantic',
            similarityThreshold: 0.7,
          },
        });
      }
    }

    return results;
  }

  private async enrichViaMemory(
    query: CrossEpicQuery,
    integrationService: { query: (q: CrossEpicQuery) => Promise<CrossEpicQueryResult>; getBundle: (epic: EpicId, entityId: string) => Promise<CrossEpicIntelligenceBundle> },
    existingLinks: CrossEpicIntelligenceLink[],
    chain: ExplainabilityStep[],
  ): Promise<CrossEpicIntelligenceLink[]> {
    const results: CrossEpicIntelligenceLink[] = [];
    const visited = new Set(existingLinks.map((l) => `${l.sourceEpic}:${l.sourceEntityId}->${l.targetEpic}:${l.targetEntityId}:${l.domain}`));

    for (const link of existingLinks) {
      if (results.length >= (query.maxResults ?? 100) - existingLinks.length) break;

      const bundle = await integrationService.getBundle(link.targetEpic, link.targetEntityId);
      for (const msg of bundle.messages) {
        if (msg.confidence < this.config.confidenceDecayPerHop) continue;

        const memoryConfidence = Number((msg.confidence * (1 - this.config.confidenceDecayPerHop * 0.5)).toFixed(4));
        if (memoryConfidence < (query.minConfidence ?? 0)) continue;

        const memoryLink: CrossEpicIntelligenceLink = {
          linkId: randomUUID(),
          sourceEpic: msg.sourceEpic,
          targetEpic: msg.targetEpic,
          sourceEntityId: msg.sourceEntityId,
          targetEntityId: msg.targetEntityId,
          domain: msg.domain as IntelligenceDomain,
          direction: 'bidirectional',
          intelligence: msg.intelligence,
          confidence: memoryConfidence,
          evidence: msg.evidence.map((e) => ({
            ...e,
            provenance: {
              ...e.provenance,
              extractor: 'memory-enrichment',
              method: 'memory_lookup',
              extractedAt: new Date(),
            },
          })),
          provenance: {
            extractor: 'memory-enrichment',
            method: 'memory_lookup',
            sourceProvider: 'cross-epic-broker',
            extractedAt: new Date(),
            consentState: 'unknown' as const,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const key = `${memoryLink.sourceEpic}:${memoryLink.sourceEntityId}->${memoryLink.targetEpic}:${memoryLink.targetEntityId}:${memoryLink.domain}`;
        if (visited.has(key)) continue;

        results.push(memoryLink);
        visited.add(key);

        chain.push({
          stepId: randomUUID(),
          hop: 1,
          sourceEpic: link.sourceEpic,
          sourceEntityId: link.sourceEntityId,
          intelligenceType: msg.domain,
          confidence: memoryConfidence,
          reasoning: `Memory enrichment: retrieved historical memory from ${msg.sourceEpic}:${msg.sourceEntityId}`,
          evidenceExcerpt: msg.evidence[0]?.excerpt ?? 'Memory lookup result',
          provenance: {
            hop: 1,
            lookupType: 'memory',
            messageTimestamp: msg.timestamp.toISOString(),
          },
        });
      }
    }

    return results;
  }

  private async enrichViaTimeline(
    query: CrossEpicQuery,
    integrationService: { query: (q: CrossEpicQuery) => Promise<CrossEpicQueryResult>; getBundle: (epic: EpicId, entityId: string) => Promise<CrossEpicIntelligenceBundle> },
    existingLinks: CrossEpicIntelligenceLink[],
    chain: ExplainabilityStep[],
  ): Promise<CrossEpicIntelligenceLink[]> {
    const results: CrossEpicIntelligenceLink[] = [];
    const visited = new Set(existingLinks.map((l) => `${l.sourceEpic}:${l.sourceEntityId}->${l.targetEpic}:${l.targetEntityId}:${l.domain}`));

    for (const link of existingLinks) {
      if (results.length >= (query.maxResults ?? 100) - existingLinks.length) break;

      const bundle = await integrationService.getBundle(link.targetEpic, link.targetEntityId);
      for (const msg of bundle.messages) {
        if (msg.confidence < this.config.confidenceDecayPerHop) continue;

        const timelineConfidence = Number((msg.confidence * (1 - this.config.confidenceDecayPerHop * 0.3)).toFixed(4));
        if (timelineConfidence < (query.minConfidence ?? 0)) continue;

        const timelineLink: CrossEpicIntelligenceLink = {
          linkId: randomUUID(),
          sourceEpic: msg.sourceEpic,
          targetEpic: msg.targetEpic,
          sourceEntityId: msg.sourceEntityId,
          targetEntityId: msg.targetEntityId,
          domain: msg.domain as IntelligenceDomain,
          direction: 'bidirectional',
          intelligence: { ...msg.intelligence, timelineEnriched: true },
          confidence: timelineConfidence,
          evidence: msg.evidence.map((e) => ({
            ...e,
            provenance: {
              ...e.provenance,
              extractor: 'timeline-enrichment',
              method: 'timeline_lookup',
              extractedAt: new Date(),
            },
          })),
          provenance: {
            extractor: 'timeline-enrichment',
            method: 'timeline_lookup',
            sourceProvider: 'cross-epic-broker',
            extractedAt: new Date(),
            consentState: 'unknown' as const,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const key = `${timelineLink.sourceEpic}:${timelineLink.sourceEntityId}->${timelineLink.targetEpic}:${timelineLink.targetEntityId}:${timelineLink.domain}`;
        if (visited.has(key)) continue;

        results.push(timelineLink);
        visited.add(key);

        chain.push({
          stepId: randomUUID(),
          hop: 1,
          sourceEpic: link.sourceEpic,
          sourceEntityId: link.sourceEntityId,
          intelligenceType: msg.domain,
          confidence: timelineConfidence,
          reasoning: `Timeline enrichment: retrieved temporal context from ${msg.sourceEpic}:${msg.sourceEntityId}`,
          evidenceExcerpt: msg.evidence[0]?.excerpt ?? 'Timeline lookup result',
          provenance: {
            hop: 1,
            lookupType: 'timeline',
            messageTimestamp: msg.timestamp.toISOString(),
          },
        });
      }
    }

    return results;
  }

  private assembleContext(
    links: CrossEpicIntelligenceLink[],
    messages: CrossEpicIntelligenceMessage[],
  ): BrokerResult['contextAssembly'] {
    const semanticExcerpts: string[] = [];
    const graphTraversalPaths: string[] = [];
    const memorySnapshots: string[] = [];
    const timelineEvents: string[] = [];
    const structuredFacts: string[] = [];

    for (const link of links) {
      semanticExcerpts.push(...link.evidence.map((e) => e.excerpt));
      graphTraversalPaths.push(`${link.sourceEpic}:${link.sourceEntityId}->${link.targetEpic}:${link.targetEntityId}`);
      structuredFacts.push(`${link.domain}: ${JSON.stringify(link.intelligence).slice(0, 200)}`);
    }

    for (const msg of messages) {
      memorySnapshots.push(JSON.stringify(msg.intelligence).slice(0, 300));
      timelineEvents.push(`${msg.timestamp.toISOString()} [${msg.sourceEpic}->${msg.targetEpic}]: ${msg.domain}`);
    }

    return {
      semanticExcerpts: semanticExcerpts.slice(0, 50),
      graphTraversalPaths: graphTraversalPaths.slice(0, 20),
      memorySnapshots: memorySnapshots.slice(0, 30),
      timelineEvents: timelineEvents.slice(0, 20),
      structuredFacts: structuredFacts.slice(0, 50),
    };
  }
}