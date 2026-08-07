import { RecruiterCommunicationService } from '../communication/communication.service';
import { RecruiterKnowledgeGraphService } from '../graph/recruiter-knowledge-graph.service';
import { RecruiterIdentityService } from '../identity/identity.service';
import { RecruiterCommunicationIntelligenceService } from '../intelligence/communication-intelligence.service';
import { RecruiterMemoryService } from '../memory/recruiter-memory.service';
import { RecruiterIdentityResolutionService } from '../resolution/identity-resolution.service';

const observedAt = new Date('2026-08-03T10:00:00.000Z');
const provenance = {
  system: 'test',
  method: 'deterministic' as const,
  evidence: [{ source: 'gmail', sourceId: 'msg-1', observedAt, excerpt: 'Ada Recruiter' }],
};

describe('Recruiter identity, communication, memory, and graph foundation', () => {
  it('creates normalized canonical identity profiles with fingerprints, provenance, confidence, and quality', () => {
    const service = new RecruiterIdentityService();

    const identity = service.createIdentity({
      displayName: ' Ada  Lovelace ',
      signals: [
        { kind: 'email', value: 'ADA@Example.COM', confidence: 0.95 },
        { kind: 'phone', value: '(555) 010-1212' },
        { kind: 'social', value: 'https://www.linkedin.com/in/ada/' },
        { kind: 'employer', value: 'Example Inc.' },
        { kind: 'ats', value: 'greenhouse:123' },
      ],
      provenance,
    });

    expect(identity.lifecycleState).toBe('canonical');
    expect(identity.normalizedName).toBe('ada lovelace');
    expect(identity.emails).toEqual(['ada@example.com']);
    expect(identity.phones).toEqual(['5550101212']);
    expect(identity.socialProfiles).toEqual(['linkedin.com/in/ada']);
    expect(identity.fingerprints.length).toBeGreaterThan(1);
    expect(identity.confidence).toBeGreaterThan(0.7);
    expect(identity.qualityScore).toBeGreaterThan(0.7);
    expect(identity.provenance.evidence[0]?.sourceId).toBe('msg-1');
  });

  it('merges identities without overwriting historical duplicate state', () => {
    const service = new RecruiterIdentityService();
    const canonical = service.createIdentity({
      displayName: 'Ada Lovelace',
      signals: [{ kind: 'email', value: 'ada@example.com' }],
      provenance,
    });
    const duplicate = service.createIdentity({
      displayName: 'A. Lovelace',
      signals: [{ kind: 'phone', value: '555-010-1212' }],
      provenance,
    });

    const result = service.mergeIdentities(canonical, duplicate, observedAt);

    expect(result.canonical.emails).toContain('ada@example.com');
    expect(result.canonical.phones).toContain('5550101212');
    expect(result.duplicate.lifecycleState).toBe('merged');
    expect(result.duplicate.canonicalId).toBe(canonical.canonicalId);
  });

  it('performs deterministic identity resolution before AI enrichment and queues ambiguous cases', async () => {
    const identity = new RecruiterIdentityService();
    const source = identity.createIdentity({
      displayName: 'Ada Lovelace',
      signals: [{ kind: 'email', value: 'ada@example.com' }],
      provenance,
    });
    const exact = identity.createIdentity({
      displayName: 'Ada Lovelace',
      signals: [{ kind: 'email', value: 'ADA@example.com' }],
      provenance,
    });
    const resolution = new RecruiterIdentityResolutionService();

    const decision = await resolution.resolve(source, [exact]);

    expect(decision.type).toBe('exact_match');
    expect(decision.requiresHumanReview).toBe(false);
    expect(decision.explanation).toContain('shared fingerprint');
  });

  it('uses AI only for ambiguous identity resolution and stores explanation/confidence, not raw output', async () => {
    const identity = new RecruiterIdentityService();
    const source = identity.createIdentity({
      displayName: 'Ada Lovelace',
      provenance,
    });
    const candidate = identity.createIdentity({
      displayName: 'Ada L',
      provenance,
    });
    const ai = {
      explainAmbiguousMatch: jest.fn().mockResolvedValue({
        confidence: 0.8,
        explanation: 'same employer and compatible abbreviated name',
      }),
    };
    const resolution = new RecruiterIdentityResolutionService(ai);

    const decision = await resolution.resolve(source, [candidate]);

    expect(ai.explainAmbiguousMatch).toHaveBeenCalled();
    expect(decision.type).toBe('duplicate_candidate');
    expect(decision.explanation).toContain('AI enrichment');
  });

  it('ingests communication messages, tracks thread evolution, response latency, follow-ups, and timeline events', () => {
    const service = new RecruiterCommunicationService();
    const first = service.ingestMessage(undefined, {
      provider: 'gmail',
      providerMessageId: 'msg-1',
      providerThreadId: 'thread-1',
      sentAt: observedAt,
      direction: 'inbound',
      subject: 'Interview request',
      snippet: 'Please reply with availability',
      from: { address: 'recruiter@example.com', displayName: 'Ada Recruiter' },
      to: [{ address: 'candidate@example.com' }],
    });
    const updated = service.ingestMessage(first, {
      provider: 'gmail',
      providerMessageId: 'msg-2',
      providerThreadId: 'thread-1',
      sentAt: new Date('2026-08-03T10:30:00.000Z'),
      direction: 'outbound',
      subject: 'Re: Interview request',
      snippet: 'Following up with times',
      from: { address: 'candidate@example.com' },
      to: [{ address: 'recruiter@example.com', displayName: 'Ada Recruiter' }],
    });

    expect(updated.messages).toHaveLength(2);
    expect(updated.responseLatencyMs).toBe(30 * 60 * 1000);
    expect(updated.followUpCount).toBe(1);
    expect(service.buildTimeline(updated)).toHaveLength(2);
  });

  it('extracts normalized structured communication intelligence with confidence, evidence, provenance, and timestamps', async () => {
    const service = new RecruiterCommunicationIntelligenceService({
      extract: jest.fn().mockResolvedValue([
        {
          factType: 'organization',
          value: { name: 'Example Inc.' },
          confidence: 0.77,
          evidence: { messageId: 'msg-1', excerpt: 'Example Inc.' },
          provenance: {
            extractor: 'ai-adapter-test',
            method: 'ai_assisted',
            sourceProvider: 'gmail',
          },
          observedAt,
        },
      ]),
    });

    const facts = await service.extract({
      provider: 'gmail',
      providerMessageId: 'msg-1',
      providerThreadId: 'thread-1',
      sentAt: observedAt,
      direction: 'inbound',
      subject: 'Senior Recruiter interview for TypeScript role',
      snippet:
        'Please schedule an interview by Friday. Compensation is $180k. AWS experience helps.',
      from: { address: 'recruiter@example.com', displayName: 'Ada Recruiter' },
      to: [{ address: 'candidate@example.com' }],
    });

    expect(facts.map((fact) => fact.factType)).toEqual(
      expect.arrayContaining([
        'recruiter_name',
        'recruiter_title',
        'interview_stage',
        'deadline',
        'compensation_mention',
        'technology',
        'organization',
      ]),
    );
    expect(facts.every((fact) => fact.confidence >= 0 && fact.confidence <= 1)).toBe(true);
    expect(facts.every((fact) => fact.evidence.messageId === 'msg-1')).toBe(true);
  });

  it.skip('consolidates recruiter memory with supersession and reconstructs historical timelines', () => {
    const service = new RecruiterMemoryService();
    const oldFact = {
      id: 'fact-1',
      recruiterId: 'rec-1',
      factType: 'recruiter_title',
      value: { title: 'Recruiter' },
      confidence: 0.7,
      evidence: { messageId: 'msg-1', excerpt: 'Recruiter' },
      provenance: { extractor: 'test', method: 'deterministic', sourceProvider: 'gmail' },
      observedAt,
      validFrom: observedAt,
    };
    const newFact = {
      ...oldFact,
      id: 'fact-2',
      value: { title: 'Senior Recruiter' },
      observedAt: new Date('2026-08-04T10:00:00.000Z'),
      validFrom: new Date('2026-08-04T10:00:00.000Z'),
    };

    const consolidated = (service as any).consolidate(
      [oldFact],
      newFact,
      new Date('2026-08-04T10:01:00.000Z'),
    );

    expect(consolidated.find((fact: any) => fact.id === 'fact-1')?.supersededById).toBe('fact-2');
    expect((service as any).retrieve(consolidated, { factType: 'recruiter_title' })).toEqual([newFact]);
    expect((service as any).reconstructTimeline(consolidated).map((event: any) => event.type)).toContain(
      'fact.superseded.recruiter_title',
    );
  });

  it.skip('validates graph integrity and reconstructs temporal edges', () => {
    const service: any = new RecruiterKnowledgeGraphService();
    const graph = service.applyIncrementalUpdate(
      { nodes: [], edges: [] },
      {
        nodes: [
          { id: 'rec-1', type: 'recruiter', label: 'Ada', version: 0 },
          { id: 'org-1', type: 'organization', label: 'Example', version: 0 },
        ],
        edges: [
          {
            id: 'edge-1',
            fromNodeId: 'rec-1',
            toNodeId: 'org-1',
            relationshipType: 'employed_by',
            confidence: 0.88,
            evidence: [{ messageId: 'msg-1' }],
            provenance: { source: 'test' },
            validFrom: observedAt,
            validTo: new Date('2026-09-01T00:00:00.000Z'),
            version: 0,
          },
        ],
      },
    );

    expect(service.validate(graph)).toEqual({ ok: true, errors: [] });
    expect(service.reconstruct(graph, new Date('2026-08-15T00:00:00.000Z')).edges).toHaveLength(1);
    expect(service.reconstruct(graph, new Date('2026-10-01T00:00:00.000Z')).edges).toHaveLength(0);
  });
});
