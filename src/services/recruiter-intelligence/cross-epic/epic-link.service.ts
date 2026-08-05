import { randomUUID } from 'crypto';
import type {
  CrossEpicIntelligenceLink,
  CrossEpicIntelligenceMessage,
  CrossEpicQuery,
  CrossEpicQueryResult,
  EpicId,
  IntelligenceDomain,
} from '../../../domain/recruiter-intelligence/cross-epic/contracts';

export interface EpicLinkConfig {
  enabled: boolean;
  maxLinksPerEntity: number;
  maxMessagesPerEntity: number;
  defaultTtlMs: number;
  confidenceThreshold: number;
  deduplicationEnabled: boolean;
  provenanceTrackingEnabled: boolean;
  explainabilityEnabled: boolean;
}

const DEFAULT_EPIC_LINK_CONFIG: EpicLinkConfig = {
  enabled: true,
  maxLinksPerEntity: 50,
  maxMessagesPerEntity: 200,
  defaultTtlMs: 7 * 24 * 60 * 60 * 1000,
  confidenceThreshold: 0.30,
  deduplicationEnabled: true,
  provenanceTrackingEnabled: true,
  explainabilityEnabled: true,
};

const ALL_EPICS: EpicId[] = [
  'user-intelligence',
  'opportunity-intelligence',
  'application-intelligence',
  'resume-intelligence',
  'company-intelligence',
  'recruiter-intelligence',
];

export class EpicLinkService {
  private readonly config: EpicLinkConfig;
  private readonly links = new Map<string, CrossEpicIntelligenceLink>();
  private readonly messages = new Map<string, CrossEpicIntelligenceMessage>();
  private readonly entityLinks = new Map<string, Set<string>>();

  constructor(config?: Partial<EpicLinkConfig>) {
    this.config = { ...DEFAULT_EPIC_LINK_CONFIG, ...config };
  }

  getConfig(): Readonly<EpicLinkConfig> {
    return this.config;
  }

  async publish(
    sourceEpic: EpicId,
    sourceEntityId: string,
    targetEpic: EpicId,
    targetEntityId: string,
    domain: IntelligenceDomain,
    intelligence: Record<string, unknown>,
    confidence: number,
    evidence: Array<{ evidenceId: string; excerpt: string; confidence: number }>,
    provenance: { extractor: string; method: string; sourceProvider: string; model?: string; templateId?: string; templateVersion?: string },
  ): Promise<CrossEpicIntelligenceLink> {
    if (!this.config.enabled) {
      throw new Error('Cross-epic integration is disabled');
    }

    if (confidence < this.config.confidenceThreshold) {
      return this.createLink(sourceEpic, sourceEntityId, targetEpic, targetEntityId, domain, intelligence, confidence, evidence, provenance);
    }

    const linkId = this.deduplicateLink(sourceEpic, sourceEntityId, targetEpic, targetEntityId, domain);
    if (linkId && this.config.deduplicationEnabled) {
      const existing = this.links.get(linkId);
      if (existing && existing.confidence >= confidence) {
        return existing;
      }
      this.links.delete(linkId);
      this.removeEntityLink(sourceEpic, sourceEntityId, linkId);
      this.removeEntityLink(targetEpic, targetEntityId, linkId);
    }

    const link = this.createLink(sourceEpic, sourceEntityId, targetEpic, targetEntityId, domain, intelligence, confidence, evidence, provenance);
    this.links.set(link.linkId, link);
    this.addEntityLink(sourceEpic, sourceEntityId, link.linkId);
    this.addEntityLink(targetEpic, targetEntityId, link.linkId);

    const message = this.createMessage(sourceEpic, sourceEntityId, targetEpic, targetEntityId, domain, intelligence, confidence, evidence, provenance);
    this.messages.set(message.messageId, message);
    this.enforceEntityMessageLimit(sourceEpic, sourceEntityId);
    this.enforceEntityMessageLimit(targetEpic, targetEntityId);

    return link;
  }

  async query(request: CrossEpicQuery): Promise<CrossEpicQueryResult> {
    const targetEpics = request.targetEpics ?? ALL_EPICS;
    const minConfidence = request.minConfidence ?? 0;
    const maxResults = request.maxResults ?? 100;

    const sourceKey = this.entityKey(request.sourceEpic, request.sourceEntityId);
    const linkIds = this.entityLinks.get(sourceKey);

    let results: CrossEpicIntelligenceLink[] = [];
    if (linkIds) {
      results = [...linkIds]
        .map((id) => this.links.get(id))
        .filter((link): link is CrossEpicIntelligenceLink => link !== undefined)
        .filter((link) => targetEpics.includes(link.targetEpic))
        .filter((link) => link.confidence >= minConfidence)
        .filter((link) => !request.domains || request.domains.includes(link.domain));
    }

    results.sort((a, b) => b.confidence - a.confidence);
    results = results.slice(0, maxResults);

    const messages = this.messagesForLinks(results);

    return {
      query: request,
      results,
      messages,
      totalConfidence: results.length > 0 ? results.reduce((s, l) => s + l.confidence, 0) / results.length : 0,
      evidenceCount: results.reduce((s, l) => s + l.evidence.length, 0),
      completedAt: new Date(),
    };
  }

  async publishBidirectional(
    epicA: EpicId,
    entityA: string,
    epicB: EpicId,
    entityB: string,
    domain: IntelligenceDomain,
    intelligenceA: Record<string, unknown>,
    intelligenceB: Record<string, unknown>,
    confidence: number,
    evidence: Array<{ evidenceId: string; excerpt: string; confidence: number }>,
    provenance: { extractor: string; method: string; sourceProvider: string; model?: string; templateId?: string; templateVersion?: string },
  ): Promise<{ linkA: CrossEpicIntelligenceLink; linkB: CrossEpicIntelligenceLink }> {
    const linkA = await this.publish(epicA, entityA, epicB, entityB, domain, intelligenceA, confidence, evidence, provenance);
    const linkB = await this.publish(epicB, entityB, epicA, entityA, domain, intelligenceB, confidence, evidence, provenance);
    return { linkA, linkB };
  }

  getLinksForEntity(epic: EpicId, entityId: string): CrossEpicIntelligenceLink[] {
    const key = this.entityKey(epic, entityId);
    const linkIds = this.entityLinks.get(key);
    if (!linkIds) return [];
    return [...linkIds].map((id) => this.links.get(id)).filter((l): l is CrossEpicIntelligenceLink => l !== undefined);
  }

  getStats(): { totalLinks: number; activeLinks: number; linksByDomain: Record<string, number>; linksBySourceEpic: Record<string, number>; linksByTargetEpic: Record<string, number>; averageConfidence: number; messagesProcessed: number; lastUpdatedAt: Date } {
    const links = [...this.links.values()];
    const activeLinks = links.filter((l) => !this.isExpired(l));

    const linksByDomain: Record<string, number> = {};
    const linksBySourceEpic: Record<string, number> = {};
    const linksByTargetEpic: Record<string, number> = {};

    const allDomains = [
      'identity', 'skills', 'behavior', 'opportunity', 'company',
      'application', 'resume', 'communication', 'decision', 'reputation', 'technical', 'market',
    ];
    for (const d of allDomains) linksByDomain[d] = 0;
    for (const epic of ALL_EPICS) {
      linksBySourceEpic[epic] = 0;
      linksByTargetEpic[epic] = 0;
    }

    for (const link of activeLinks) {
      linksByDomain[link.domain] = (linksByDomain[link.domain] ?? 0) + 1;
      linksBySourceEpic[link.sourceEpic] = (linksBySourceEpic[link.sourceEpic] ?? 0) + 1;
      linksByTargetEpic[link.targetEpic] = (linksByTargetEpic[link.targetEpic] ?? 0) + 1;
    }

    const avgConfidence = activeLinks.length > 0
      ? activeLinks.reduce((s, l) => s + l.confidence, 0) / activeLinks.length
      : 0;

    return {
      totalLinks: links.length,
      activeLinks: activeLinks.length,
      linksByDomain,
      linksBySourceEpic,
      linksByTargetEpic,
      averageConfidence: Number(avgConfidence.toFixed(4)),
      messagesProcessed: this.messages.size,
      lastUpdatedAt: new Date(),
    };
  }

  async getBundle(sourceEpic: EpicId, sourceEntityId: string): Promise<{ bundleId: string; sourceEpic: EpicId; sourceEntityId: string; links: CrossEpicIntelligenceLink[]; messages: CrossEpicIntelligenceMessage[]; overallConfidence: number; generatedAt: Date }> {
    const links = this.getLinksForEntity(sourceEpic, sourceEntityId);
    const messages = this.messagesForLinks(links);

    return {
      bundleId: randomUUID(),
      sourceEpic,
      sourceEntityId,
      links,
      messages,
      overallConfidence: links.length > 0 ? links.reduce((s, l) => s + l.confidence, 0) / links.length : 0,
      generatedAt: new Date(),
    };
  }

  async getBidirectionalLinks(epicA: EpicId, entityA: string, epicB: EpicId, entityB: string): Promise<{ aToB: CrossEpicIntelligenceLink[]; bToA: CrossEpicIntelligenceLink[] }> {
    const aToB = this.getLinksForEntity(epicA, entityA).filter((l) => l.targetEpic === epicB && l.targetEntityId === entityB);
    const bToA = this.getLinksForEntity(epicB, entityB).filter((l) => l.targetEpic === epicA && l.targetEntityId === entityA);
    return { aToB, bToA };
  }

  removeExpiredLinks(): number {
    let removed = 0;
    for (const [linkId, link] of this.links.entries()) {
      if (this.isExpired(link)) {
        this.links.delete(linkId);
        this.removeEntityLink(link.sourceEpic, link.sourceEntityId, linkId);
        this.removeEntityLink(link.targetEpic, link.targetEntityId, linkId);
        removed++;
      }
    }
    return removed;
  }

  private createLink(
    sourceEpic: EpicId,
    sourceEntityId: string,
    targetEpic: EpicId,
    targetEntityId: string,
    domain: IntelligenceDomain,
    intelligence: Record<string, unknown>,
    confidence: number,
    evidence: Array<{ evidenceId: string; excerpt: string; confidence: number }>,
    provenance: { extractor: string; method: string; sourceProvider: string; model?: string; templateId?: string; templateVersion?: string },
  ): CrossEpicIntelligenceLink {
    return {
      linkId: randomUUID(),
      sourceEpic,
      targetEpic,
      sourceEntityId,
      targetEntityId,
      domain,
      direction: 'bidirectional',
      intelligenceType: JSON.stringify(intelligence),
      intelligence,
      confidence: Math.max(0, Math.min(1, confidence)),
      evidence: evidence.map((e) => ({
        evidenceId: e.evidenceId,
        sourceEpic,
        sourceEntityId,
        excerpt: e.excerpt,
        confidence: e.confidence,
        provenance: {
          extractor: provenance.extractor,
          method: provenance.method as any,
          sourceProvider: provenance.sourceProvider,
          model: provenance.model,
          templateId: provenance.templateId,
          templateVersion: provenance.templateVersion,
          extractedAt: new Date(),
          consentState: 'unknown' as const,
        },
      })),
      provenance: {
        extractor: provenance.extractor,
        method: provenance.method as any,
        sourceProvider: provenance.sourceProvider,
        model: provenance.model,
        templateId: provenance.templateId,
        templateVersion: provenance.templateVersion,
        extractedAt: new Date(),
        consentState: 'unknown' as const,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private createMessage(
    sourceEpic: EpicId,
    sourceEntityId: string,
    targetEpic: EpicId,
    targetEntityId: string,
    domain: IntelligenceDomain,
    intelligence: Record<string, unknown>,
    confidence: number,
    evidence: Array<{ evidenceId: string; excerpt: string; confidence: number }>,
    provenance: { extractor: string; method: string; sourceProvider: string; model?: string; templateId?: string; templateVersion?: string },
  ): CrossEpicIntelligenceMessage {
    return {
      messageId: randomUUID(),
      sourceEpic,
      sourceEntityId,
      targetEpic,
      targetEntityId,
      domain,
      intelligence,
      confidence,
      evidence: evidence.map((e) => ({
        evidenceId: e.evidenceId,
        sourceEpic,
        sourceEntityId,
        excerpt: e.excerpt,
        confidence: e.confidence,
        provenance: {
          extractor: provenance.extractor,
          method: provenance.method as any,
          sourceProvider: provenance.sourceProvider,
          model: provenance.model,
          templateId: provenance.templateId,
          templateVersion: provenance.templateVersion,
          extractedAt: new Date(),
          consentState: 'unknown' as const,
        },
      })),
      provenance: {
        extractor: provenance.extractor,
        method: provenance.method as any,
        sourceProvider: provenance.sourceProvider,
        model: provenance.model,
        templateId: provenance.templateId,
        templateVersion: provenance.templateVersion,
        extractedAt: new Date(),
        consentState: 'unknown' as const,
      },
      timestamp: new Date(),
      ttlMs: this.config.defaultTtlMs,
    };
  }

  private deduplicateLink(sourceEpic: EpicId, sourceEntityId: string, targetEpic: EpicId, targetEntityId: string, domain: IntelligenceDomain): string | null {
    if (!this.config.deduplicationEnabled) return null;
    const key = this.edgeKey(sourceEpic, sourceEntityId, targetEpic, targetEntityId, domain);
    return this.links.has(key) ? key : null;
  }

  private edgeKey(sourceEpic: EpicId, sourceEntityId: string, targetEpic: EpicId, targetEntityId: string, domain: IntelligenceDomain): string {
    return `${sourceEpic}:${sourceEntityId}->${targetEpic}:${targetEntityId}:${domain}`;
  }

  private entityKey(epic: EpicId, entityId: string): string {
    return `${epic}:${entityId}`;
  }

  private addEntityLink(epic: EpicId, entityId: string, linkId: string): void {
    const key = this.entityKey(epic, entityId);
    const set = this.entityLinks.get(key) ?? new Set<string>();
    set.add(linkId);
    this.entityLinks.set(key, set);
  }

  private removeEntityLink(epic: EpicId, entityId: string, linkId: string): void {
    const key = this.entityKey(epic, entityId);
    const set = this.entityLinks.get(key);
    if (set) {
      set.delete(linkId);
      if (set.size === 0) this.entityLinks.delete(key);
    }
  }

  private enforceEntityMessageLimit(epic: EpicId, entityId: string): void {
    const key = this.entityKey(epic, entityId);
    const linkIds = this.entityLinks.get(key);
    if (!linkIds || linkIds.size <= this.config.maxLinksPerEntity) return;

    const messagesForEntity = [...this.messages.values()].filter(
      (m) => (m.sourceEpic === epic && m.sourceEntityId === entityId) || (m.targetEpic === epic && m.targetEntityId === entityId),
    );

    if (messagesForEntity.length > this.config.maxMessagesPerEntity) {
      const excess = messagesForEntity.length - this.config.maxMessagesPerEntity;
      const sorted = messagesForEntity.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      for (let i = 0; i < excess; i++) {
        this.messages.delete(sorted[i]!.messageId);
      }
    }
  }

  private messagesForLinks(links: CrossEpicIntelligenceLink[]): CrossEpicIntelligenceMessage[] {
    const messageIds = new Set<string>();
    const result: CrossEpicIntelligenceMessage[] = [];
    for (const link of links) {
      for (const [, msg] of this.messages.entries()) {
        if (msg.sourceEpic === link.sourceEpic && msg.sourceEntityId === link.sourceEntityId && msg.targetEpic === link.targetEpic && msg.targetEntityId === link.targetEntityId && !messageIds.has(msg.messageId)) {
          messageIds.add(msg.messageId);
          result.push(msg);
        }
      }
    }
    return result;
  }

  private isExpired(link: CrossEpicIntelligenceLink): boolean {
    return Date.now() - link.createdAt.getTime() > this.config.defaultTtlMs;
  }
}