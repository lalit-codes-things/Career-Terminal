import { CrossEpicIntelligenceIntegrationService } from '../cross-epic/cross-epic-integration.service';
import { EpicLinkService } from '../cross-epic/epic-link.service';
import { IntelligenceBrokerService } from '../../../cross-epic/intelligence-broker.service';

describe('Cross-Epic Intelligence Integration', () => {
  let service: CrossEpicIntelligenceIntegrationService;
  let linkService: EpicLinkService;
  let broker: IntelligenceBrokerService;

  beforeEach(() => {
    service = new CrossEpicIntelligenceIntegrationService();
    linkService = new EpicLinkService();
    broker = new IntelligenceBrokerService();
  });

  describe('CrossEpicIntelligenceIntegrationService', () => {
    test('publish creates a cross-epic link', async () => {
      const link = await service.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe is a recruiter', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      expect(link.linkId).toBeDefined();
      expect(link.sourceEpic).toBe('recruiter-intelligence');
      expect(link.targetEpic).toBe('company-intelligence');
      expect(link.domain).toBe('identity');
      expect(link.confidence).toBe(0.85);
      expect(link.evidence.length).toBe(1);
    });

    test('query returns matching cross-epic links', async () => {
      await service.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      const result = await service.query({
        sourceEpic: 'recruiter-intelligence',
        sourceEntityId: 'recruiter-1',
        targetEpics: ['company-intelligence'],
        domains: ['identity'],
        minConfidence: 0.5,
        requireEvidence: true,
        maxResults: 10,
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].sourceEpic).toBe('recruiter-intelligence');
      expect(result.totalConfidence).toBeGreaterThan(0);
    });

    test('publishBidirectional creates links in both directions', async () => {
      const { linkA, linkB } = await service.publishBidirectional(
        'resume-intelligence',
        'resume-1',
        'recruiter-intelligence',
        'recruiter-1',
        'skills',
        { skills: ['TypeScript', 'React'] },
        { skills: ['TypeScript', 'React'] },
        0.80,
        [{ evidenceId: 'e1', excerpt: 'TypeScript', confidence: 0.8 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      expect(linkA.sourceEpic).toBe('resume-intelligence');
      expect(linkA.targetEpic).toBe('recruiter-intelligence');
      expect(linkB.sourceEpic).toBe('recruiter-intelligence');
      expect(linkB.targetEpic).toBe('resume-intelligence');
    });

    test('getLinksForEntity returns all links for an entity', async () => {
      await service.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      await service.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'opportunity-intelligence',
        'opp-1',
        'decision',
        { hiringPriority: 'high' },
        0.75,
        [{ evidenceId: 'e2', excerpt: 'high priority', confidence: 0.8 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      const links = service.getLinksForEntity('recruiter-intelligence', 'recruiter-1');
      expect(links.length).toBe(2);
    });

    test('getStats returns accurate statistics', async () => {
      await service.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      const stats = service.getStats();
      expect(stats.totalLinks).toBe(1);
      expect(stats.activeLinks).toBe(1);
      expect(stats.linksBySourceEpic['recruiter-intelligence']).toBe(1);
      expect(stats.linksByTargetEpic['company-intelligence']).toBe(1);
      expect(stats.averageConfidence).toBe(0.85);
    });

    test('getBundle returns all links and messages for an entity', async () => {
      await service.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      const bundle = await service.getBundle('recruiter-intelligence', 'recruiter-1');
      expect(bundle.sourceEpic).toBe('recruiter-intelligence');
      expect(bundle.sourceEntityId).toBe('recruiter-1');
      expect(bundle.links.length).toBe(1);
      expect(bundle.messages.length).toBe(1);
      expect(bundle.overallConfidence).toBe(0.85);
    });

    test('getBidirectionalLinks returns links in both directions', async () => {
      await service.publishBidirectional(
        'resume-intelligence',
        'resume-1',
        'recruiter-intelligence',
        'recruiter-1',
        'skills',
        { skills: ['TypeScript'] },
        { skills: ['TypeScript'] },
        0.80,
        [{ evidenceId: 'e1', excerpt: 'TypeScript', confidence: 0.8 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      const { aToB, bToA } = await service.getBidirectionalLinks(
        'resume-intelligence', 'resume-1',
        'recruiter-intelligence', 'recruiter-1',
      );

      expect(aToB.length).toBe(1);
      expect(bToA.length).toBe(1);
      expect(aToB[0].sourceEpic).toBe('resume-intelligence');
      expect(bToA[0].sourceEpic).toBe('recruiter-intelligence');
    });

    test('removeExpiredLinks prunes expired links', async () => {
      const expiredService = new CrossEpicIntelligenceIntegrationService({
        defaultTtlMs: 0,
      });

      await expiredService.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      const removed = expiredService.removeExpiredLinks();
      expect(removed).toBe(1);
      expect(expiredService.getStats().activeLinks).toBe(0);
    });

    test('getConfig returns the configuration', () => {
      const config = service.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.maxLinksPerEntity).toBe(50);
      expect(config.maxMessagesPerEntity).toBe(200);
      expect(config.confidenceThreshold).toBe(0.30);
      expect(config.deduplicationEnabled).toBe(true);
      expect(config.provenanceTrackingEnabled).toBe(true);
      expect(config.explainabilityEnabled).toBe(true);
    });
  });

  describe('EpicLinkService', () => {
    test('publish creates an epic link', async () => {
      const link = await linkService.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      expect(link.linkId).toBeDefined();
      expect(link.sourceEpic).toBe('recruiter-intelligence');
      expect(link.targetEpic).toBe('company-intelligence');
    });

    test('query returns matching epic links', async () => {
      await linkService.publish(
        'recruiter-intelligence',
        'recruiter-1',
        'company-intelligence',
        'company-1',
        'identity',
        { recruiterName: 'John Doe' },
        0.85,
        [{ evidenceId: 'e1', excerpt: 'John Doe', confidence: 0.9 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      const result = await linkService.query({
        sourceEpic: 'recruiter-intelligence',
        sourceEntityId: 'recruiter-1',
        minConfidence: 0.5,
        maxResults: 10,
      });

      expect(result.results.length).toBe(1);
      expect(result.evidenceCount).toBe(1);
    });

    test('publishBidirectional creates bidirectional links', async () => {
      const { linkA, linkB } = await linkService.publishBidirectional(
        'resume-intelligence',
        'resume-1',
        'recruiter-intelligence',
        'recruiter-1',
        'skills',
        { skills: ['TypeScript'] },
        { skills: ['TypeScript'] },
        0.80,
        [{ evidenceId: 'e1', excerpt: 'TypeScript', confidence: 0.8 }],
        { extractor: 'test', method: 'deterministic', sourceProvider: 'test' },
      );

      expect(linkA.sourceEpic).toBe('resume-intelligence');
      expect(linkB.sourceEpic).toBe('recruiter-intelligence');
    });

    test('getConfig returns the configuration', () => {
      const config = linkService.getConfig();
      expect(config.maxLinksPerEntity).toBe(50);
      expect(config.maxMessagesPerEntity).toBe(200);
      expect(config.defaultTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(config.confidenceThreshold).toBe(0.30);
    });
  });

  describe('IntelligenceBrokerService', () => {
    test('broker performs multi-hop enrichment', async () => {
      const integrationService = {
        query: async (q: any) => ({
          query: q,
          results: [],
          messages: [],
          totalConfidence: 0,
          evidenceCount: 0,
          completedAt: new Date(),
        }),
        getBundle: async () => ({
          bundleId: 'test',
          sourceEpic: 'recruiter-intelligence',
          sourceEntityId: 'recruiter-1',
          links: [],
          messages: [],
          overallConfidence: 0,
          generatedAt: new Date(),
        }),
      };

      const result = await broker.broker(
        {
          sourceEpic: 'recruiter-intelligence',
          sourceEntityId: 'recruiter-1',
          minConfidence: 0.3,
          maxResults: 10,
          requireEvidence: true,
        },
        integrationService,
      );

      expect(result.query.sourceEpic).toBe('recruiter-intelligence');
      expect(result.enrichedIntelligence).toBeDefined();
      expect(result.contextAssembly).toBeDefined();
      expect(result.explainabilityChain).toBeDefined();
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    test('broker respects maxResults limit', async () => {
      const integrationService = {
        query: async (q: any) => ({
          query: q,
          results: [],
          messages: [],
          totalConfidence: 0,
          evidenceCount: 0,
          completedAt: new Date(),
        }),
        getBundle: async () => ({
          bundleId: 'test',
          sourceEpic: 'recruiter-intelligence',
          sourceEntityId: 'recruiter-1',
          links: [],
          messages: [],
          overallConfidence: 0,
          generatedAt: new Date(),
        }),
      };

      const result = await broker.broker(
        {
          sourceEpic: 'recruiter-intelligence',
          sourceEntityId: 'recruiter-1',
          maxResults: 5,
          minConfidence: 0.3,
          requireEvidence: true,
        },
        integrationService,
      );

      expect(result.enrichedIntelligence.length).toBeLessThanOrEqual(5);
    });

    test('getConfig returns the configuration', () => {
      const config = broker.getConfig();
      expect(config.maxHops).toBe(3);
      expect(config.confidenceDecayPerHop).toBe(0.15);
      expect(config.maxContextTokens).toBe(8000);
      expect(config.enableGraphRagEnrichment).toBe(true);
      expect(config.enableSemanticEnrichment).toBe(true);
      expect(config.enableMemoryEnrichment).toBe(true);
      expect(config.enableTimelineEnrichment).toBe(true);
      expect(config.enableProvenanceChaining).toBe(true);
    });
  });
});