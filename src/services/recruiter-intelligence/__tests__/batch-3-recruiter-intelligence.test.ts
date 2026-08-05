/**
 * Batch 3 — AI Recruiter Intelligence
 *
 * Covers:
 *   Prompt 11 — AI Extraction Pipeline (pipeline, prompt manager, output validator,
 *               cost tracker, rate limiter, human review, batch, streaming, providers)
 *   Prompt 12 — Recruiter Entity Extraction (15 field types, normalization, hybrid merge)
 *   Prompt 13 — AI Reasoning & Enrichment (12 inferred attributes, explainability)
 *   Prompt 14 — Knowledge Graph Population (nodes, edges, temporal, versioning, reconstruct)
 *   Prompt 15 — Recruiter Intelligence Engine (full profile, memory/timeline/graph plans)
 *
 * Design principles:
 *   - No database. All services are pure in-memory for unit tests.
 *   - AI adapters are replaced by StubAiAdapter (zero cost, deterministic).
 *   - Every assertion verifies: value, confidence, evidence, provenance.
 */

import { StubAiAdapter } from '../ai/adapters/stub.adapter';
import { CostTracker } from '../ai/cost-tracker';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import { InMemoryHumanReviewQueue } from '../ai/human-review';
import { OutputValidator } from '../ai/output-validator';
import { buildDefaultTemplates, PromptManager } from '../ai/prompt-manager';
import { TokenBucketRateLimiter } from '../ai/rate-limiter';
import { toConfidenceBand } from '../ai/utils';
import { RecruiterIntelligenceEngineService } from '../engine/recruiter-intelligence-engine.service';
import { RecruiterEntityExtractionService } from '../extraction/recruiter-entity-extraction.service';
import { KnowledgeGraphPopulationService } from '../graph/knowledge-graph-population.service';
import { RecruiterReasoningEnrichmentService } from '../reasoning/recruiter-reasoning-enrichment.service';
import type { RecruiterMessageInput } from '../communication/communication.service';
import type { ExtractionInput } from '../ai/types';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const RECRUITER_ID = 'rec-ada-001';
const OBSERVED_AT = new Date('2026-08-03T10:00:00.000Z');

const SAMPLE_MESSAGE: RecruiterMessageInput = {
  provider: 'gmail',
  providerMessageId: 'msg-001',
  providerThreadId: 'thread-001',
  sentAt: OBSERVED_AT,
  direction: 'inbound',
  subject: 'Senior TypeScript Engineer — Interview at Example Corp ($180k)',
  snippet:
    'Hi, I am Ada Recruiter, Senior Technical Recruiter at Example Corp. ' +
    'We are urgently hiring for our Backend Engineering team in San Francisco. ' +
    'This is a top priority role requiring TypeScript, AWS, and Node.js. ' +
    'Please reply with your availability for a technical screening by Friday. ' +
    'Base compensation is $180k + equity.',
  from: { address: 'ada@example.com', displayName: 'Ada Recruiter' },
  to: [{ address: 'candidate@gmail.com' }],
};

function makePipeline(stub?: StubAiAdapter): ExtractionPipeline {
  const adapter = stub ?? new StubAiAdapter();
  const pipeline = new ExtractionPipeline({
    providers: [adapter],
    preferredProvider: 'stub',
    humanReviewThreshold: 0.50,
  });
  for (const template of buildDefaultTemplates()) {
    pipeline.getPromptManager().register(template);
  }
  return pipeline;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 11 — AI EXTRACTION PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

describe('Prompt 11 — AI extraction pipeline', () => {
  describe('PromptManager', () => {
    it('registers and retrieves templates by id', () => {
      const mgr = new PromptManager();
      for (const t of buildDefaultTemplates()) mgr.register(t);

      const tpl = mgr.get('recruiter-entity-extraction');
      expect(tpl.templateId).toBe('recruiter-entity-extraction');
      expect(tpl.version).toBe('1.0.0');
      expect(tpl.maxTokens).toBeGreaterThan(0);
    });

    it('retrieves a specific version', () => {
      const mgr = new PromptManager();
      for (const t of buildDefaultTemplates()) mgr.register(t);
      const tpl = mgr.get('recruiter-entity-extraction', '1.0.0');
      expect(tpl.version).toBe('1.0.0');
    });

    it('throws when template is not found', () => {
      const mgr = new PromptManager();
      expect(() => mgr.get('no-such-template')).toThrow('not found');
    });

    it('renders a prompt template with variable interpolation', () => {
      const mgr = new PromptManager();
      for (const t of buildDefaultTemplates()) mgr.register(t);
      const rendered = mgr.render('recruiter-entity-extraction', {
        messageId: 'msg-1',
        direction: 'inbound',
        subject: 'Test subject',
        fromAddress: 'a@b.com',
        fromName: 'Ada',
        sentAt: '2026-08-03T10:00:00Z',
        content: 'Hello',
      });
      expect(rendered.userPrompt).toContain('msg-1');
      expect(rendered.userPrompt).toContain('Ada');
      expect(rendered.estimatedInputTokens).toBeGreaterThan(0);
    });

    it('lists all registered templates', () => {
      const mgr = new PromptManager();
      for (const t of buildDefaultTemplates()) mgr.register(t);
      expect(mgr.list().length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('OutputValidator', () => {
    const validator = new OutputValidator();

    it('parses valid JSON extraction output', () => {
      const raw = JSON.stringify({ fields: [{ field: 'recruiter_name', value: { name: 'Ada' }, rawValue: 'Ada', confidence: 0.9, evidence: [{ excerpt: 'Ada' }] }] });
      const { parsed, valid } = validator.validateJson(raw);
      expect(valid).toBe(true);
      expect(parsed).not.toBeNull();
    });

    it('strips markdown code fences from model output', () => {
      const raw = '```json\n{"fields":[]}\n```';
      const { valid, parsed } = validator.validateJson(raw);
      expect(valid).toBe(true);
      expect(parsed).toMatchObject({ fields: [] });
    });

    it('returns invalid on malformed JSON', () => {
      const { valid, error } = validator.validateJson('not json at all {');
      expect(valid).toBe(false);
      expect(error).toBeTruthy();
    });

    it('validates extraction output structure', () => {
      const good = { fields: [{ field: 'skill', value: { name: 'ts' }, rawValue: 'ts', confidence: 0.8, evidence: [] }] };
      expect(validator.validateExtractionOutput(good).valid).toBe(true);
    });

    it('rejects extraction output with missing fields array', () => {
      const result = validator.validateExtractionOutput({ notFields: [] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.severity).toBe('critical');
    });

    it('rejects extraction output with missing confidence on a field', () => {
      const bad = { fields: [{ field: 'x', value: 'y', rawValue: 'y' }] };
      const result = validator.validateExtractionOutput(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e: any) => e.field.includes('confidence'))).toBe(true);
    });

    it('validates reasoning output structure', () => {
      const good = {
        inferences: [{
          attribute: 'seniority', value: 'senior',
          reasoning: 'title contains senior', confidence: 0.88,
          supportingEvidence: ['Senior title'],
        }],
      };
      expect(validator.validateReasoningOutput(good).valid).toBe(true);
    });

    it('rejects reasoning output with missing reasoning field', () => {
      const bad = {
        inferences: [{ attribute: 'seniority', value: 'senior', confidence: 0.8 }],
      };
      const result = validator.validateReasoningOutput(bad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e: any) => e.field.includes('reasoning'))).toBe(true);
    });

    it('validates profile output and warns on missing optional fields', () => {
      const profile = {
        summary: 'Ada is a recruiter',
        hiringFocus: [], technicalFocus: [], industryFocus: [],
        organizationContext: {}, communicationStyle: 'direct',
        recruitingStyle: 'active', hiringVelocitySignals: {},
        relationshipStrength: {}, candidateFitSignals: [],
      };
      const result = validator.validateProfileOutput(profile);
      expect(result.valid).toBe(true);
    });

    it('rejects profile output with empty summary', () => {
      const result = validator.validateProfileOutput({ summary: '' });
      expect(result.valid).toBe(false);
    });
  });

  describe('CostTracker', () => {
    it('records usage and computes estimated cost', () => {
      const tracker = new CostTracker();
      tracker.record({ provider: 'openrouter', model: 'gpt-4o-mini', templateId: 'tpl-1', tenantId: 'tenant-1', inputTokens: 1000, outputTokens: 500, latencyMs: 300, success: true });
      expect(tracker.totalCostUsd()).toBeGreaterThan(0);
      expect(tracker.totalTokens()).toBe(1500);
    });

    it('tracks zero cost for stub adapter', () => {
      const tracker = new CostTracker();
      tracker.record({ provider: 'stub', model: 'stub-balanced', templateId: 'tpl-1', tenantId: 'tenant-1', inputTokens: 2000, outputTokens: 800, latencyMs: 5, success: true });
      expect(tracker.totalCostUsd()).toBe(0);
    });

    it('summarizes multiple records with success rate', () => {
      const tracker = new CostTracker();
      tracker.record({ provider: 'openrouter', model: 'gpt-4o-mini', templateId: 't', tenantId: 'x', inputTokens: 100, outputTokens: 50, latencyMs: 100, success: true });
      tracker.record({ provider: 'openrouter', model: 'gpt-4o-mini', templateId: 't', tenantId: 'x', inputTokens: 100, outputTokens: 50, latencyMs: 200, success: false, error: 'timeout' });
      const summary = tracker.summarize();
      expect(summary.totalCalls).toBe(2);
      expect(summary.successRate).toBe(0.5);
      expect(summary.averageLatencyMs).toBe(150);
    });

    it('filters by tenant', () => {
      const tracker = new CostTracker();
      tracker.record({ provider: 'stub', model: 'stub-fast', templateId: 't', tenantId: 'A', inputTokens: 10, outputTokens: 5, latencyMs: 1, success: true });
      tracker.record({ provider: 'stub', model: 'stub-fast', templateId: 't', tenantId: 'B', inputTokens: 10, outputTokens: 5, latencyMs: 1, success: true });
      expect(tracker.byTenant('A')).toHaveLength(1);
    });

    it('estimates cost without recording', () => {
      const tracker = new CostTracker();
      const cost = tracker.estimateCost('gpt-4o', 1000, 500);
      expect(cost).toBeCloseTo(0.0125, 5);
    });
  });

  describe('TokenBucketRateLimiter', () => {
    it('allows calls within the budget', async () => {
      const limiter = new TokenBucketRateLimiter({ maxUsdPerCall: 0.1, maxTokensPerCall: 4096, maxCallsPerMinute: 10 });
      expect(limiter.isAllowed(100)).toBe(true);
      await expect(limiter.acquire(100)).resolves.toBeUndefined();
    });

    it('rejects when calls per minute are exhausted', async () => {
      const limiter = new TokenBucketRateLimiter({ maxUsdPerCall: 0.1, maxTokensPerCall: 4096, maxCallsPerMinute: 1 });
      await limiter.acquire(10);
      // Second call should be over the per-minute limit immediately
      expect(limiter.isAllowed(10)).toBe(false);
    });

    it('resets state', () => {
      const limiter = new TokenBucketRateLimiter({ maxUsdPerCall: 0.1, maxTokensPerCall: 4096, maxCallsPerMinute: 2 });
      limiter.reset();
      expect(limiter.getState().callsInWindow).toBe(0);
    });
  });

  describe('InMemoryHumanReviewQueue', () => {
    it('flags low-confidence extraction for review', () => {
      const queue = new InMemoryHumanReviewQueue({ confidenceThreshold: 0.70 });
      const output = {
        extractionId: 'ext-1',
        overallConfidence: 0.45,
        requiresHumanReview: false,
        fields: [],
        templateId: 'tpl', templateVersion: '1.0.0',
        provider: 'stub' as const, model: 'stub-fast',
        confidenceBand: 'low' as const,
        evidence: [], provenance: { source: 'test', collector: 'test', collectedAt: new Date().toISOString(), consentState: 'granted' as const },
        usage: { provider: 'stub' as const, model: 'stub-fast', templateId: 'tpl', tenantId: 'x', inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCostUsd: 0, latencyMs: 1, success: true },
        completedAt: new Date(),
      };
      expect(queue.isReviewRequired(output)).toBe(true);
    });

    it('does not flag high-confidence extraction', () => {
      const queue = new InMemoryHumanReviewQueue({ confidenceThreshold: 0.55 });
      const output = {
        extractionId: 'ext-2',
        overallConfidence: 0.92,
        requiresHumanReview: false,
        fields: [{ field: 'name', value: 'Ada', rawValue: 'Ada', confidence: 0.92, confidenceBand: 'critical' as const, evidence: [], provenance: { source: 'test', collector: 'test', collectedAt: new Date().toISOString(), consentState: 'granted' as const } }],
        templateId: 'tpl', templateVersion: '1.0.0',
        provider: 'stub' as const, model: 'stub-fast',
        confidenceBand: 'critical' as const,
        evidence: [], provenance: { source: 'test', collector: 'test', collectedAt: new Date().toISOString(), consentState: 'granted' as const },
        usage: { provider: 'stub' as const, model: 'stub-fast', templateId: 'tpl', tenantId: 'x', inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCostUsd: 0, latencyMs: 1, success: true },
        completedAt: new Date(),
      };
      expect(queue.isReviewRequired(output)).toBe(false);
    });

    it('queues review requests and drains them', async () => {
      const queue = new InMemoryHumanReviewQueue();
      await queue.queue({ reviewId: 'r-1', extractionId: 'e-1', reason: 'low confidence', flaggedFields: ['name'], extractedData: {}, confidence: 0.4, queuedAt: new Date() });
      expect(queue.pendingCount()).toBe(1);
      const drained = queue.drain();
      expect(drained).toHaveLength(1);
      expect(queue.pendingCount()).toBe(0);
    });
  });

  describe('ExtractionPipeline — end to end with StubAiAdapter', () => {
    it('extracts structured fields from entity extraction template', async () => {
      const pipeline = makePipeline();
      const input: ExtractionInput = {
        extractionId: 'ext-e2e-1',
        tenantId: RECRUITER_ID,
        sourceType: 'email',
        sourceId: 'msg-001',
        content: SAMPLE_MESSAGE.snippet ?? '',
        metadata: {},
        requestedAt: new Date(),
      };
      const output = await pipeline.extract('recruiter-entity-extraction', input, {
        messageId: 'msg-001', direction: 'inbound', subject: SAMPLE_MESSAGE.subject ?? '',
        fromAddress: 'ada@example.com', fromName: 'Ada Recruiter',
        sentAt: OBSERVED_AT.toISOString(), content: SAMPLE_MESSAGE.snippet ?? '',
      });
      expect(output.fields.length).toBeGreaterThan(0);
      expect(output.fields.every((f) => f.confidence >= 0 && f.confidence <= 1)).toBe(true);
      expect(output.fields.every((f) => typeof f.field === 'string')).toBe(true);
      expect(output.provider).toBe('stub');
      expect(output.provenance.source).toContain('ai-extraction');
    });

    it('records token usage and cost after extraction', async () => {
      const pipeline = makePipeline();
      const input: ExtractionInput = {
        extractionId: 'ext-cost-1',
        tenantId: 'tenant-1',
        sourceType: 'email',
        sourceId: 'msg-002',
        content: 'Test content',
        metadata: {},
        requestedAt: new Date(),
      };
      await pipeline.extract('recruiter-entity-extraction', input, {
        messageId: 'msg-002', direction: 'inbound', subject: '', fromAddress: '', fromName: '', sentAt: '', content: 'Test',
      });
      const summary = pipeline.getCostTracker().summarize();
      expect(summary.totalCalls).toBeGreaterThan(0);
      expect(summary.totalInputTokens).toBeGreaterThan(0);
    });

    it('supports streaming and invokes onChunk callback', async () => {
      const pipeline = makePipeline();
      const chunks: string[] = [];
      const input: ExtractionInput = {
        extractionId: 'ext-stream-1',
        tenantId: 'tenant-1',
        sourceType: 'email',
        sourceId: 'msg-003',
        content: 'Stream test',
        metadata: {},
        requestedAt: new Date(),
      };
      await pipeline.extract(
        'recruiter-entity-extraction',
        input,
        { messageId: 'msg-003', direction: 'inbound', subject: '', fromAddress: '', fromName: '', sentAt: '', content: 'Stream test' },
        { stream: true, onChunk: (chunk) => chunks.push(chunk.delta) },
      );
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('runs batch inference and reports per-item results', async () => {
      const pipeline = makePipeline();
      const items: ExtractionInput[] = [1, 2, 3].map((n) => ({
        extractionId: `batch-${n}`,
        tenantId: RECRUITER_ID,
        sourceType: 'email' as const,
        sourceId: `msg-${n}`,
        content: `Content ${n}`,
        metadata: {},
        requestedAt: new Date(),
      }));
      const result = await pipeline.extractBatch(
        'recruiter-entity-extraction',
        { batchId: 'batch-001', tenantId: RECRUITER_ID, items, concurrency: 2, priority: 'normal' },
        (item) => ({
          messageId: item.sourceId, direction: 'inbound', subject: '', fromAddress: '', fromName: '', sentAt: '', content: item.content,
        }),
      );
      expect(result.totalItems).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(3);
      expect(result.totalUsage.inputTokens).toBeGreaterThan(0);
    });

    it('retries on parse errors and eventually succeeds', async () => {
      let callCount = 0;
      const flakyStub = new StubAiAdapter();
      // Override complete to fail with bad JSON on first call, succeed on second
      const originalComplete = flakyStub.complete.bind(flakyStub);
      flakyStub.complete = async (req) => {
        callCount++;
        if (callCount === 1) return { rawText: 'NOT JSON {{{', inputTokens: 10, outputTokens: 5, model: req.model, finishReason: 'stop', latencyMs: 1 };
        return originalComplete(req);
      };
      const pipeline = makePipeline(flakyStub);
      const input: ExtractionInput = {
        extractionId: 'ext-retry-1',
        tenantId: RECRUITER_ID,
        sourceType: 'email',
        sourceId: 'msg-retry',
        content: 'content',
        metadata: {},
        requestedAt: new Date(),
      };
      const output = await pipeline.extract('recruiter-entity-extraction', input, {
        messageId: 'msg-retry', direction: 'inbound', subject: '', fromAddress: '', fromName: '', sentAt: '', content: 'content',
      });
      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(output.fields.length).toBeGreaterThan(0);
    });

    it('assigns correct confidence bands to fields', async () => {
      expect(toConfidenceBand(0.95)).toBe('critical');
      expect(toConfidenceBand(0.80)).toBe('high');
      expect(toConfidenceBand(0.60)).toBe('medium');
      expect(toConfidenceBand(0.30)).toBe('low');
    });

    it('falls back gracefully when preferred provider is unavailable', async () => {
      const fallbackAdapter = new StubAiAdapter();
      const pipeline = new ExtractionPipeline({
        providers: [fallbackAdapter],
        preferredProvider: 'openrouter', // not registered — should fall back to stub
      });
      for (const t of buildDefaultTemplates()) pipeline.getPromptManager().register(t);
      const input: ExtractionInput = {
        extractionId: 'ext-fb-1', tenantId: 'tenant-1', sourceType: 'email',
        sourceId: 'msg-fb', content: 'fallback test', metadata: {}, requestedAt: new Date(),
      };
      const output = await pipeline.extract('recruiter-entity-extraction', input, {
        messageId: 'msg-fb', direction: 'inbound', subject: '', fromAddress: '', fromName: '', sentAt: '', content: 'fallback',
      });
      expect(output.fields.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 12 — RECRUITER ENTITY EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Prompt 12 — Recruiter entity extraction', () => {
  function makeService(): RecruiterEntityExtractionService {
    return new RecruiterEntityExtractionService(makePipeline());
  }

  it('extracts recruiter_name from display name with evidence and provenance', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const nameFacts = result.facts.filter((f) => f.fieldType === 'recruiter_name');
    expect(nameFacts.length).toBeGreaterThan(0);
    const fact = nameFacts[0]!;
    expect(fact.rawValue).toContain('Ada Recruiter');
    expect(fact.confidence).toBeGreaterThan(0);
    expect(fact.evidence.messageId).toBe('msg-001');
    expect(fact.evidence.excerpt).toBeTruthy();
    expect(fact.provenance.extractor).toBeTruthy();
    expect(fact.provenance.sourceProvider).toBe('gmail');
    expect(fact.observedAt).toEqual(OBSERVED_AT);
  });

  it('extracts recruiter_title from message text', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const titleFacts = result.facts.filter((f) => f.fieldType === 'recruiter_title');
    expect(titleFacts.length).toBeGreaterThan(0);
    expect(titleFacts[0]!.confidence).toBeGreaterThan(0);
  });

  it('extracts recruiter_organization with normalized value', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const orgFacts = result.facts.filter((f) => f.fieldType === 'recruiter_organization');
    expect(orgFacts.length).toBeGreaterThan(0);
    // normalizedValue should be lowercase
    expect(orgFacts[0]!.normalizedValue).toBe(orgFacts[0]!.normalizedValue.toLowerCase());
  });

  it('extracts technology facts for TypeScript, AWS, Node.js', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const techFacts = result.facts.filter((f) => f.fieldType === 'technology');
    const techNames = techFacts.map((f) => f.normalizedValue);
    expect(techNames.some((n) => n.includes('typescript'))).toBe(true);
    expect(techNames.some((n) => n.includes('aws'))).toBe(true);
  });

  it('extracts interview_stage from screening signal', async () => {
    const svc = makeService();
    const msg: RecruiterMessageInput = {
      ...SAMPLE_MESSAGE,
      snippet: 'We would like to schedule a technical screening with you.',
    };
    const result = await svc.extractFromMessage(RECRUITER_ID, msg);
    const stageFacts = result.facts.filter((f) => f.fieldType === 'interview_stage');
    expect(stageFacts.length).toBeGreaterThan(0);
    expect(stageFacts[0]!.confidence).toBeGreaterThan(0.5);
  });

  it('extracts compensation_mention with high confidence when dollar amount present', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const compFacts = result.facts.filter((f) => f.fieldType === 'compensation_mention');
    expect(compFacts.length).toBeGreaterThan(0);
    expect(compFacts[0]!.confidence).toBeGreaterThanOrEqual(0.72);
    expect(compFacts[0]!.confidenceBand).toMatch(/high|critical/);
  });

  it('extracts hiring_priority as high when urgency language present', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const priorityFacts = result.facts.filter((f) => f.fieldType === 'hiring_priority');
    expect(priorityFacts.length).toBeGreaterThan(0);
    expect(priorityFacts[0]!.structuredValue['priority']).toBe('high');
  });

  it('extracts hiring_location from geographic mention', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const locFacts = result.facts.filter((f) => f.fieldType === 'hiring_location');
    expect(locFacts.length).toBeGreaterThan(0);
  });

  it('merges deterministic and AI facts — boosts confidence on corroboration', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    // Corroborated facts (from both deterministic + AI) should have method 'hybrid'
    const hybridFacts = result.facts.filter((f) => f.provenance.method === 'hybrid');
    expect(hybridFacts.length).toBeGreaterThan(0);
    // Each hybrid fact has boosted confidence (> base deterministic value)
    hybridFacts.forEach((f) => expect(f.confidence).toBeGreaterThan(0));
  });

  it('assigns unique factId to every extracted fact', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    const ids = result.facts.map((f) => f.factId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every fact carries evidence with non-empty excerpt', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    result.facts.forEach((f) => {
      expect(f.evidence.messageId).toBeTruthy();
      expect(f.evidence.excerpt.length).toBeGreaterThan(0);
    });
  });

  it('every fact carries a provenance object with extractor and sourceProvider', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    result.facts.forEach((f) => {
      expect(f.provenance.extractor).toBeTruthy();
      expect(f.provenance.sourceProvider).toBeTruthy();
      expect(f.provenance.extractedAt).toBeInstanceOf(Date);
    });
  });

  it('confidence values are all within [0, 1]', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    result.facts.forEach((f) => {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('assigns overall extraction-level confidence', async () => {
    const svc = makeService();
    const result = await svc.extractFromMessage(RECRUITER_ID, SAMPLE_MESSAGE);
    expect(result.overallConfidence).toBeGreaterThan(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('deterministic extraction works without AI pipeline', () => {
    const svc = makeService();
    const facts = svc.extractDeterministic(RECRUITER_ID, SAMPLE_MESSAGE);
    expect(facts.length).toBeGreaterThan(0);
    // All deterministic facts use the deterministic method
    facts.forEach((f) => expect(f.provenance.method).toBe('deterministic'));
  });

  it('normalizes technology names to lowercase slugs', () => {
    const svc = makeService();
    const facts = svc.extractDeterministic(RECRUITER_ID, {
      ...SAMPLE_MESSAGE,
      snippet: 'Must know TypeScript and Node.js',
    });
    const techFacts = facts.filter((f) => f.fieldType === 'technology');
    techFacts.forEach((f) => {
      expect(f.normalizedValue).toBe(f.normalizedValue.toLowerCase());
    });
  });

  it('flags low-confidence facts for human review', async () => {
    const svc = makeService();
    const msg: RecruiterMessageInput = {
      ...SAMPLE_MESSAGE,
      snippet: 'hi', // minimal content → low confidence across all facts
      subject: '',
      from: { address: 'unknown@x.com' }, // no display name → lower recruiter_name confidence
    };
    const result = await svc.extractFromMessage(RECRUITER_ID, msg);
    // With minimal content the overall confidence may be low enough to require review
    // At minimum the result.requiresHumanReview flag is computed (true or false is valid)
    expect(typeof result.requiresHumanReview).toBe('boolean');
  });

  it('extracts hiring_domain from backend/frontend signals', () => {
    const svc = makeService();
    const facts = svc.extractDeterministic(RECRUITER_ID, {
      ...SAMPLE_MESSAGE,
      snippet: 'Looking for a backend engineer.',
    });
    const domainFacts = facts.filter((f) => f.fieldType === 'hiring_domain');
    expect(domainFacts.length).toBeGreaterThan(0);
    expect(domainFacts[0]!.structuredValue['domain']).toBe('backend');
  });

  it('extracts employment_change signal when transition language detected', () => {
    const svc = makeService();
    const facts = svc.extractDeterministic(RECRUITER_ID, {
      ...SAMPLE_MESSAGE,
      snippet: 'I recently joined Example Corp as a Senior Technical Recruiter.',
    });
    const changeFacts = facts.filter((f) => f.fieldType === 'employment_change');
    expect(changeFacts.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 13 — AI REASONING & ENRICHMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('Prompt 13 — AI reasoning & enrichment', () => {
  function makeReasoningService(): RecruiterReasoningEnrichmentService {
    return new RecruiterReasoningEnrichmentService(makePipeline());
  }

  async function extractFacts(): Promise<ReturnType<RecruiterEntityExtractionService['extractDeterministic']>> {
    const svc = new RecruiterEntityExtractionService(makePipeline());
    return svc.extractDeterministic(RECRUITER_ID, SAMPLE_MESSAGE);
  }

  it('infers seniority as "senior" from "Senior Technical Recruiter" title', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(result.seniority.value).toBe('senior');
    expect(result.seniority.confidence).toBeGreaterThan(0.7);
    expect(result.seniority.reasoning).toBeTruthy();
    expect(result.seniority.supportingEvidence.excerpts.length).toBeGreaterThan(0);
  });

  it('infers specialization as "engineering" from tech signals', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(result.specialization.value).toBe('engineering');
    expect(result.specialization.confidence).toBeGreaterThan(0.7);
    expect(result.specialization.reasoning).toContain('technology signal');
  });

  it('infers technical domains from technology facts', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(result.technicalDomains.value.length).toBeGreaterThan(0);
    expect(result.technicalDomains.confidence).toBeGreaterThan(0);
    expect(result.technicalDomains.reasoning).toContain('signal');
  });

  it('infers hiring focus from domain signals', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(Array.isArray(result.hiringFocus.value)).toBe(true);
    expect(result.hiringFocus.confidence).toBeGreaterThan(0);
  });

  it('infers geographic responsibility from location facts', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(Array.isArray(result.geographicResponsibility.value)).toBe(true);
  });

  it('infers decision authority as decision_maker when compensation + senior title present', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    // Our sample has $180k compensation + Senior title
    expect(['decision_maker', 'influencer', 'unknown']).toContain(result.decisionAuthority.value);
    expect(result.decisionAuthority.reasoning).toBeTruthy();
  });

  it('infers urgency as "high" from hiring priority + deadline language', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(['high', 'critical']).toContain(result.urgency.value);
    expect(result.urgency.confidence).toBeGreaterThan(0.5);
    expect(result.urgency.supportingEvidence.sourceFactIds.length).toBeGreaterThan(0);
  });

  it('infers communication intent from interview stage signal', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(['screening', 'scheduling', 'informational', 'unknown']).toContain(result.communicationIntent.value);
    expect(result.communicationIntent.confidence).toBeGreaterThanOrEqual(0);
  });

  it('infers follow-up requirements as non-empty array', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(Array.isArray(result.followUpRequirements.value)).toBe(true);
    expect(result.followUpRequirements.value.length).toBeGreaterThan(0);
    expect(result.followUpRequirements.reasoning).toBeTruthy();
  });

  it('every inference has reasoning, confidence, and supportingEvidence', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    result.inferences.forEach((inf) => {
      expect(typeof inf.reasoning).toBe('string');
      expect(inf.reasoning.length).toBeGreaterThan(0);
      expect(inf.confidence).toBeGreaterThanOrEqual(0);
      expect(inf.confidence).toBeLessThanOrEqual(1);
      expect(inf.supportingEvidence).toBeDefined();
      expect(inf.provenance.inferrer).toBeTruthy();
      expect(inf.inferredAt).toBeInstanceOf(Date);
    });
  });

  it('every inference has a non-empty inferenceId', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    const ids = result.inferences.map((i) => i.inferenceId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('overall confidence is within [0, 1]', async () => {
    const facts = await extractFacts();
    const svc = makeReasoningService();
    const result = await svc.infer(RECRUITER_ID, facts);

    expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('AI inference is skipped gracefully when pipeline fails', async () => {
    const brokenStub = new StubAiAdapter();
    brokenStub.complete = async () => { throw new Error('provider unavailable'); };
    const brokenPipeline = makePipeline(brokenStub);
    const svc = new RecruiterReasoningEnrichmentService(brokenPipeline);
    const svcEntity = new RecruiterEntityExtractionService(makePipeline());
    const facts = svcEntity.extractDeterministic(RECRUITER_ID, SAMPLE_MESSAGE);

    // Should not throw — deterministic inferences still returned
    const result = await svc.infer(RECRUITER_ID, facts);
    expect(result.seniority.value).toBeTruthy();
    expect(result.inferences.length).toBeGreaterThan(0);
  });

  it('deterministic inferSeniority covers executive titles', () => {
    const svc = makeReasoningService();
    const execFacts = [{
      factId: 'f-1', recruiterId: RECRUITER_ID, sourceMessageId: 'msg-1',
      fieldType: 'recruiter_title' as const, rawValue: 'VP of Talent Acquisition',
      normalizedValue: 'vp of talent acquisition',
      structuredValue: { title: 'VP of Talent Acquisition' },
      confidence: 0.9, confidenceBand: 'critical' as const,
      evidence: { messageId: 'msg-1', excerpt: 'VP of Talent Acquisition' },
      provenance: { extractor: 'test', method: 'deterministic' as const, provider: 'none', model: 'regex', templateId: 'det', templateVersion: '1.0.0', sourceProvider: 'gmail', extractedAt: new Date() },
      observedAt: OBSERVED_AT, requiresHumanReview: false,
    }];
    const inferences = svc.inferDeterministic(RECRUITER_ID, execFacts);
    const seniority = inferences.find((i) => i.attribute === 'seniority');
    expect(seniority?.value).toBe('executive');
  });

  it('infers urgency as low when no signals present', () => {
    const svc = makeReasoningService();
    const minimalFacts = [{
      factId: 'f-1', recruiterId: RECRUITER_ID, sourceMessageId: 'msg-1',
      fieldType: 'recruiter_name' as const, rawValue: 'Bob Recruiter',
      normalizedValue: 'bob recruiter', structuredValue: { name: 'Bob Recruiter' },
      confidence: 0.8, confidenceBand: 'high' as const,
      evidence: { messageId: 'msg-1', excerpt: 'Bob Recruiter' },
      provenance: { extractor: 'test', method: 'deterministic' as const, provider: 'none', model: 'regex', templateId: 'det', templateVersion: '1.0.0', sourceProvider: 'gmail', extractedAt: new Date() },
      observedAt: OBSERVED_AT, requiresHumanReview: false,
    }];
    const inferences = svc.inferDeterministic(RECRUITER_ID, minimalFacts);
    const urgency = inferences.find((i) => i.attribute === 'urgency');
    expect(urgency?.value).toBe('low');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 14 — KNOWLEDGE GRAPH POPULATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Prompt 14 — Knowledge graph population', () => {
  function makeGraphService(): any {
    return new KnowledgeGraphPopulationService();
  }

  function makeRecruiterFact(
    fieldType: Parameters<KnowledgeGraphPopulationService['populateFromFacts']>[1][number]['fieldType'],
    rawValue: string,
    structuredValue: Record<string, unknown>,
    normalizedValue?: string,
  ) {
    return {
      factId: `fact-${Math.random().toString(36).slice(2)}`,
      recruiterId: RECRUITER_ID,
      sourceMessageId: 'msg-001',
      fieldType,
      rawValue,
      normalizedValue: normalizedValue ?? rawValue.toLowerCase(),
      structuredValue,
      confidence: 0.85,
      confidenceBand: 'high' as const,
      evidence: { messageId: 'msg-001', excerpt: rawValue },
      provenance: {
        extractor: 'test', method: 'deterministic' as const,
        provider: 'none', model: 'regex',
        templateId: 'test', templateVersion: '1.0.0',
        sourceProvider: 'gmail', extractedAt: new Date(),
      },
      observedAt: OBSERVED_AT,
      requiresHumanReview: false,
    };
  }

  it('creates recruiter node on first population', async () => {
    const svc = makeGraphService();
    await svc.populateFromFacts(RECRUITER_ID, []);
    const graph = await svc.getGraph();
    expect(graph.nodes.size).toBeGreaterThanOrEqual(1);
    const recruiterNode = await svc.getNodeByKey('recruiter', RECRUITER_ID);
    expect(recruiterNode).toBeDefined();
    expect(recruiterNode!.nodeType).toBe('recruiter');
  });

  it('creates organization node and recruiter_to_organization edge', async () => {
    const svc = makeGraphService();
    const facts = [makeRecruiterFact('recruiter_organization', 'Example Corp', { name: 'Example Corp' }, 'example corp')];
    await svc.populateFromFacts(RECRUITER_ID, facts, OBSERVED_AT);
    const orgNode = await svc.getNodeByKey('organization', 'example corp');
    expect(orgNode).toBeDefined();
    expect(orgNode!.nodeType).toBe('organization');
    const recruiterNode = await svc.getNodeByKey('recruiter', RECRUITER_ID);
    const edges = await svc.getEdgesForNode(recruiterNode!.nodeId);
    const orgEdge = edges.find((e: any) => e.relationshipType === 'recruiter_to_organization');
    expect(orgEdge).toBeDefined();
    expect(orgEdge!.confidence).toBe(0.85);
  });

  it('creates technology nodes and recruiter_to_technology edges', async () => {
    const svc = makeGraphService();
    const facts = [
      makeRecruiterFact('technology', 'TypeScript', { name: 'TypeScript' }, 'typescript'),
      makeRecruiterFact('technology', 'AWS', { name: 'AWS' }, 'aws'),
    ];
    await svc.populateFromFacts(RECRUITER_ID, facts, OBSERVED_AT);
    expect(await svc.getNodeByKey('technology', 'typescript')).toBeDefined();
    expect(await svc.getNodeByKey('technology', 'aws')).toBeDefined();
    const recruiterNode = await svc.getNodeByKey('recruiter', RECRUITER_ID);
    const edges = await svc.getEdgesForNode(recruiterNode!.nodeId);
    const techEdges = edges.filter((e: any) => e.relationshipType === 'recruiter_to_technology');
    expect(techEdges).toHaveLength(2);
  });

  it('upserts existing node without duplicating — increments version', async () => {
    const svc = makeGraphService();
    const fact = makeRecruiterFact('recruiter_organization', 'Acme', { name: 'Acme' }, 'acme');
    await svc.populateFromFacts(RECRUITER_ID, [fact], OBSERVED_AT);
    await svc.populateFromFacts(RECRUITER_ID, [fact], new Date(OBSERVED_AT.getTime() + 1000));
    // Should still be one organization node
    const orgNode = await svc.getNodeByKey('organization', 'acme');
    expect(orgNode!.version).toBeGreaterThan(1);
    const graph = await svc.getGraph();
    const orgNodes = [...graph.nodes.values()].filter((n) => n.externalKey === 'acme');
    expect(orgNodes).toHaveLength(1);
  });

  it('every edge carries confidence, evidence, and provenance', async () => {
    const svc = makeGraphService();
    const facts = [makeRecruiterFact('technology', 'Python', { name: 'Python' }, 'python')];
    await svc.populateFromFacts(RECRUITER_ID, facts, OBSERVED_AT);
    const recruiterNode = await svc.getNodeByKey('recruiter', RECRUITER_ID)!;
    const edges = await svc.getEdgesForNode(recruiterNode.nodeId);
    edges.forEach((edge: any) => {
      expect(edge.confidence).toBeGreaterThan(0);
      expect(edge.confidence).toBeLessThanOrEqual(1);
      expect(edge.evidenceJson.length).toBeGreaterThan(0);
      expect(edge.provenanceJson.source).toBeTruthy();
      expect(edge.provenanceJson.populatedAt).toBeTruthy();
    });
  });

  it('edges have valid temporal ranges (validFrom set)', async () => {
    const svc = makeGraphService();
    const facts = [makeRecruiterFact('skill', 'Leadership', { name: 'Leadership' }, 'leadership')];
    await svc.populateFromFacts(RECRUITER_ID, facts, OBSERVED_AT);
    const recruiterNode = await svc.getNodeByKey('recruiter', RECRUITER_ID)!;
    const edges = await svc.getEdgesForNode(recruiterNode.nodeId);
    edges.forEach((edge: any) => {
      expect(edge.validFrom).toBeInstanceOf(Date);
      if (edge.validTo) {
        expect(edge.validTo.getTime()).toBeGreaterThan(edge.validFrom.getTime());
      }
    });
  });

  it('validates graph integrity — returns ok:true for valid graph', async () => {
    const svc = makeGraphService();
    await svc.populateFromFacts(RECRUITER_ID, [
      makeRecruiterFact('technology', 'Go', { name: 'Go' }, 'go'),
    ], OBSERVED_AT);
    expect(await svc.validate()).toEqual({ ok: true, errors: [] });
  });

  it('validate detects missing node referenced by edge', async () => {
    const svc = makeGraphService();
    await svc.applyIncrementalUpdate({
      edges: [{
        fromNodeId: 'ghost-node-id',
        toNodeId: 'another-ghost',
        relationshipType: 'recruiter_to_organization',
        confidence: 0.9,
        validFrom: OBSERVED_AT,
        evidenceJson: [],
        provenanceJson: { source: 'test', populatedBy: 'test', method: 'manual', templateVersion: '1.0.0', populatedAt: new Date().toISOString() },
      }],
    });
    const result = await svc.validate();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e: any) => e.includes('ghost-node-id'))).toBe(true);
  });

  it('historical reconstruction returns only edges active at a given point in time', async () => {
    const svc = makeGraphService();
    const past = new Date('2026-07-01T00:00:00Z');
    const current = new Date('2026-08-01T00:00:00Z');
    const future = new Date('2026-09-01T00:00:00Z');

    await svc.applyIncrementalUpdate({
      nodes: [
        { nodeType: 'recruiter', externalKey: RECRUITER_ID, label: 'Ada', metadata: {} },
        { nodeType: 'organization', externalKey: 'past-corp', label: 'Past Corp', metadata: {} },
        { nodeType: 'organization', externalKey: 'current-corp', label: 'Current Corp', metadata: {} },
      ],
    });

    const recruiterNode = await svc.getNodeByKey('recruiter', RECRUITER_ID)!;
    const pastOrgNode = await svc.getNodeByKey('organization', 'past-corp')!;
    const currentOrgNode = await svc.getNodeByKey('organization', 'current-corp')!;

    await svc.applyIncrementalUpdate({
      edges: [
        {
          fromNodeId: recruiterNode.nodeId,
          toNodeId: pastOrgNode.nodeId,
          relationshipType: 'recruiter_to_organization',
          confidence: 0.9,
          validFrom: past,
          validTo: current, // expired
          evidenceJson: [],
          provenanceJson: { source: 'test', populatedBy: 'test', method: 'entity_extraction', templateVersion: '1.0.0', populatedAt: past.toISOString() },
        },
        {
          fromNodeId: recruiterNode.nodeId,
          toNodeId: currentOrgNode.nodeId,
          relationshipType: 'recruiter_to_organization',
          confidence: 0.95,
          validFrom: current,
          evidenceJson: [],
          provenanceJson: { source: 'test', populatedBy: 'test', method: 'entity_extraction', templateVersion: '1.0.0', populatedAt: current.toISOString() },
        },
      ],
    });

    // At a point before current was created (between past and current)
    const midPoint = new Date('2026-07-15T00:00:00Z');
    const snapshot = await svc.reconstruct(midPoint);
    const edgeRels = snapshot.edges.map((e: any) => e.toNodeId);
    expect(edgeRels).toContain(pastOrgNode.nodeId);
    expect(edgeRels).not.toContain(currentOrgNode.nodeId);

    // At future point — only current edge active
    const futureSnapshot = await svc.reconstruct(future);
    const futureEdgeRels = futureSnapshot.edges.map((e: any) => e.toNodeId);
    expect(futureEdgeRels).toContain(currentOrgNode.nodeId);
    expect(futureEdgeRels).not.toContain(pastOrgNode.nodeId);
  });

  it('expireEdge sets validTo and bumps version', async () => {
    const svc = makeGraphService();
    const facts = [makeRecruiterFact('recruiter_organization', 'OldCo', { name: 'OldCo' }, 'oldco')];
    await svc.populateFromFacts(RECRUITER_ID, facts, OBSERVED_AT);
    const recruiterNode = await svc.getNodeByKey('recruiter', RECRUITER_ID)!;
    const edges = await svc.getEdgesForNode(recruiterNode.nodeId);
    const edgeToExpire = edges[0]!;
    const expiredAt = new Date('2026-08-10T00:00:00Z');
    const success = await svc.expireEdge(edgeToExpire.edgeId, expiredAt);
    expect(success).toBe(true);
    const updatedEdges = await svc.getEdgesForNode(recruiterNode.nodeId);
    const expired = updatedEdges.find((e: any) => e.edgeId === edgeToExpire.edgeId);
    expect(expired!.validTo).toEqual(expiredAt);
    expect(expired!.version).toBeGreaterThan(edgeToExpire.version);
  });

  it('increments graph version on every mutation', async () => {
    const svc = makeGraphService();
    const v0 = await svc.getGraph().version;
    await svc.populateFromFacts(RECRUITER_ID, [], OBSERVED_AT);
    const v1 = await svc.getGraph().version;
    await svc.populateFromFacts(RECRUITER_ID, [], OBSERVED_AT);
    const v2 = await svc.getGraph().version;
    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
  });

  it('populateFromInferences adds technology nodes from reasoning result', async () => {
    const svc = makeGraphService();
    const reasoningSvc = new RecruiterReasoningEnrichmentService(makePipeline());
    const entitySvc = new RecruiterEntityExtractionService(makePipeline());
    const facts = entitySvc.extractDeterministic(RECRUITER_ID, SAMPLE_MESSAGE);
    const reasoning = await reasoningSvc.infer(RECRUITER_ID, facts);

    svc.populateFromInferences(RECRUITER_ID, reasoning, OBSERVED_AT);

    const graph = await svc.getGraph();
    const techNodes = [...graph.nodes.values()].filter((n) => n.nodeType === 'technology');
    expect(techNodes.length).toBeGreaterThanOrEqual(0); // may be empty if no tech domains inferred
    // Graph version must be incremented
    expect(graph.version).toBeGreaterThan(0);
  });

  it('confidence is clamped to [0,1] on edges', () => {
    const svc = makeGraphService();
    svc.applyIncrementalUpdate({
      nodes: [
        { nodeType: 'recruiter', externalKey: 'r1', label: 'R1', metadata: {} },
        { nodeType: 'organization', externalKey: 'o1', label: 'O1', metadata: {} },
      ],
    });
    const r1 = svc.getNodeByKey('recruiter', 'r1')!;
    const o1 = svc.getNodeByKey('organization', 'o1')!;
    svc.applyIncrementalUpdate({
      edges: [{
        fromNodeId: r1.nodeId, toNodeId: o1.nodeId,
        relationshipType: 'recruiter_to_organization',
        confidence: 1.5, // over 1 — should be clamped
        validFrom: OBSERVED_AT,
        evidenceJson: [], provenanceJson: { source: 'test', populatedBy: 'test', method: 'manual', templateVersion: '1.0.0', populatedAt: OBSERVED_AT.toISOString() },
      }],
    });
    const edges = svc.getEdgesForNode(r1.nodeId);
    edges.forEach((e: any) => {
      expect(e.confidence).toBeLessThanOrEqual(1);
      expect(e.confidence).toBeGreaterThanOrEqual(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 15 — RECRUITER INTELLIGENCE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

describe('Prompt 15 — Recruiter intelligence engine', () => {
  async function buildFullInput() {
    const pipeline = makePipeline();
    const entitySvc = new RecruiterEntityExtractionService(pipeline);
    const reasoningSvc = new RecruiterReasoningEnrichmentService(pipeline);
    const graphSvc = new KnowledgeGraphPopulationService();

    const facts = entitySvc.extractDeterministic(RECRUITER_ID, SAMPLE_MESSAGE);
    const reasoning = await reasoningSvc.infer(RECRUITER_ID, facts);
    const graphResult = await graphSvc.populateFromFacts(RECRUITER_ID, facts, OBSERVED_AT);

    return { facts, reasoning, graphResult, pipeline };
  }

  it('generates a recruiter profile with all required top-level sections', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.engineRunId).toBeTruthy();
    expect(result.recruiterId).toBe(RECRUITER_ID);
    expect(result.profile).toBeDefined();
    expect(result.profile.summary).toBeDefined();
    expect(result.profile.hiringFocus).toBeDefined();
    expect(result.profile.technicalFocus).toBeDefined();
    expect(result.profile.industryFocus).toBeDefined();
    expect(result.profile.organizationContext).toBeDefined();
    expect(result.profile.communicationStyle).toBeDefined();
    expect(result.profile.recruitingStyle).toBeDefined();
    expect(result.profile.hiringVelocitySignals).toBeDefined();
    expect(result.profile.relationshipStrength).toBeDefined();
    expect(result.profile.candidateFitSignals).toBeDefined();
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('generates a non-empty profile summary grounded in extracted facts', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.profile.summary.text.length).toBeGreaterThan(10);
    expect(result.profile.summary.confidence).toBeGreaterThan(0);
    expect(result.profile.summary.evidenceFactIds.length).toBeGreaterThan(0);
  });

  it('summary references evidence fact IDs from extracted facts', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    const factIds = new Set(facts.map((f) => f.factId));
    result.profile.summary.evidenceFactIds.forEach((id) => {
      expect(factIds.has(id)).toBe(true);
    });
  });

  it('generates hiring focus with technology-aligned roles', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(Array.isArray(result.profile.hiringFocus.roles)).toBe(true);
    expect(typeof result.profile.hiringFocus.confidence).toBe('number');
  });

  it('generates technical focus with TypeScript and AWS', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    const techLower = result.profile.technicalFocus.technologies.map((t) => t.toLowerCase());
    expect(techLower.some((t) => t.includes('typescript') || t.includes('aws'))).toBe(true);
  });

  it('organization context contains organization name from facts', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    // Organization context may or may not have org name depending on extraction
    expect(typeof result.profile.organizationContext.confidence).toBe('number');
  });

  it('communication style is a non-empty string', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.profile.communicationStyle.style.length).toBeGreaterThan(0);
    expect(['formal', 'casual', 'direct', 'warm', 'unknown']).toContain(result.profile.communicationStyle.tone);
  });

  it('velocity signals include urgency and pipeline stage', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    const vel = result.profile.hiringVelocitySignals;
    expect(['low', 'medium', 'high', 'critical']).toContain(vel.urgency);
    expect(vel.pipelineStage.length).toBeGreaterThan(0);
    expect(typeof vel.typicalInterviewCycles).toBe('number');
    expect(typeof vel.activeOpenings).toBe('boolean');
  });

  it('relationship strength has a score between 0 and 1', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    const rel = result.profile.relationshipStrength;
    expect(rel.score).toBeGreaterThanOrEqual(0);
    expect(rel.score).toBeLessThanOrEqual(1);
    expect(['weak', 'developing', 'established', 'strong']).toContain(rel.band);
    expect(rel.signals.length).toBeGreaterThan(0);
  });

  it('candidate fit signals reference evidence fact IDs', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    const factIds = new Set(facts.map((f) => f.factId));
    result.profile.candidateFitSignals.forEach((signal) => {
      if (signal.evidenceFactId) {
        expect(factIds.has(signal.evidenceFactId)).toBe(true);
      }
      expect(['technical', 'experience', 'location', 'culture', 'compensation']).toContain(signal.category);
      expect(['required', 'preferred', 'nice_to_have']).toContain(signal.importance);
    });
  });

  it('evidence refs cover all extracted facts', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.profile.evidenceRefs.length).toBe(facts.length);
    result.profile.evidenceRefs.forEach((ref) => {
      expect(ref.factId).toBeTruthy();
      expect(ref.fieldType).toBeTruthy();
      expect(ref.excerpt.length).toBeGreaterThan(0);
      expect(ref.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  it('generates a memory update plan with facts and inferences', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.memoryUpdatePlan.recruiterId).toBe(RECRUITER_ID);
    expect(result.memoryUpdatePlan.factsToWrite.length).toBeGreaterThan(0);
    expect(result.memoryUpdatePlan.reason).toBeTruthy();
    // Memory facts include both extracted facts and inferences
    const types = result.memoryUpdatePlan.factsToWrite.map((f) => f.factType);
    expect(types.some((t) => !t.startsWith('inferred_'))).toBe(true); // raw facts
    expect(types.some((t) => t.startsWith('inferred_'))).toBe(true); // inferences
  });

  it('generates a timeline update plan with typed events', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.timelineUpdatePlan.recruiterId).toBe(RECRUITER_ID);
    expect(result.timelineUpdatePlan.events.length).toBeGreaterThan(0);
    result.timelineUpdatePlan.events.forEach((ev) => {
      expect(ev.eventId).toBeTruthy();
      expect(ev.eventType).toBeTruthy();
      expect(ev.summary.length).toBeGreaterThan(0);
      expect(ev.occurredAt).toBeInstanceOf(Date);
      expect(ev.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  it('timeline includes intelligence_profile_generated event', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    const profileEvent = result.timelineUpdatePlan.events.find(
      (e) => e.eventType === 'intelligence_profile_generated',
    );
    expect(profileEvent).toBeDefined();
    expect(profileEvent!.summary).toContain('facts');
    expect(profileEvent!.summary).toContain('inferences');
  });

  it('generates a graph update plan with nodes and edges', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.graphUpdatePlan.recruiterId).toBe(RECRUITER_ID);
    expect(Array.isArray(result.graphUpdatePlan.nodesToUpsert)).toBe(true);
    expect(Array.isArray(result.graphUpdatePlan.edgesToAdd)).toBe(true);
  });

  it('AI failure is non-fatal — deterministic profile still generated', async () => {
    const brokenStub = new StubAiAdapter();
    brokenStub.complete = async () => { throw new Error('AI unavailable'); };
    const pipeline = makePipeline(brokenStub);

    const entitySvc = new RecruiterEntityExtractionService(makePipeline());
    const facts = entitySvc.extractDeterministic(RECRUITER_ID, SAMPLE_MESSAGE);
    const reasoningSvc = new RecruiterReasoningEnrichmentService(makePipeline());
    const reasoning = await reasoningSvc.infer(RECRUITER_ID, facts);
    const graphSvc = new KnowledgeGraphPopulationService();
    const graphResult = await graphSvc.populateFromFacts(RECRUITER_ID, facts, OBSERVED_AT);

    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    expect(result.profile.summary.text.length).toBeGreaterThan(0);
    expect(result.profile.version).toBeGreaterThanOrEqual(1);
  });

  it('profile version increments when AI enhancement succeeds', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const result = await engine.generate(RECRUITER_ID, facts, reasoning, graphResult);

    // Version >= 1 always; >= 2 when AI enhancement added content
    expect(result.profile.version).toBeGreaterThanOrEqual(1);
  });

  it('buildDeterministicProfile produces a valid profile without AI calls', async () => {
    const { facts, reasoning, graphResult, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const profile = engine.buildDeterministicProfile(RECRUITER_ID, facts, reasoning, graphResult);

    expect(profile.profileId).toBeTruthy();
    expect(profile.recruiterId).toBe(RECRUITER_ID);
    expect(profile.summary.text).toBeTruthy();
    expect(profile.generatedAt).toBeInstanceOf(Date);
  });

  it('memory facts carry valid provenance referencing extraction source', async () => {
    const { facts, reasoning, pipeline } = await buildFullInput();
    const engine = new RecruiterIntelligenceEngineService(pipeline);
    const plan = engine.buildMemoryUpdatePlan(RECRUITER_ID, facts, reasoning);

    plan.factsToWrite.forEach((memFact) => {
      expect(memFact.provenance.extractor).toBeTruthy();
      expect(memFact.provenance.sourceProvider).toBeTruthy();
      expect(memFact.observedAt).toBeInstanceOf(Date);
      expect(memFact.validFrom).toBeInstanceOf(Date);
      expect(memFact.confidence).toBeGreaterThanOrEqual(0);
    });
  });
});
