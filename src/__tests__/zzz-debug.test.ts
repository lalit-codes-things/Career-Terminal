import { StubAiAdapter } from '../services/recruiter-intelligence/ai/adapters/stub.adapter';
import { ExtractionPipeline } from '../services/recruiter-intelligence/ai/extraction-pipeline';
import { buildDefaultTemplates } from '../services/recruiter-intelligence/ai/prompt-manager';
import { RecruiterReasoningEnrichmentService } from '../services/recruiter-intelligence/reasoning/recruiter-reasoning-enrichment.service';

function makePipeline(): ExtractionPipeline {
  const adapter = new StubAiAdapter();
  const pipeline = new ExtractionPipeline({ providers: [adapter], preferredProvider: 'stub', humanReviewThreshold: 0.50 });
  for (const template of buildDefaultTemplates()) {
    pipeline.getPromptManager().register(template);
  }
  return pipeline;
}

test('debug reasoning reasoning text', async () => {
  const svc = new RecruiterReasoningEnrichmentService(makePipeline());
  const facts = [{
    factId: 'f1', recruiterId: 'r1', sourceMessageId: 'm1',
    fieldType: 'technology', rawValue: 'TypeScript',
    normalizedValue: 'typescript', structuredValue: { name: 'TypeScript' },
    confidence: 0.9, confidenceBand: 'high',
    evidence: { messageId: 'm1', excerpt: 'TypeScript' },
    provenance: { extractor: 'test', method: 'deterministic', provider: 'none', model: 'regex', templateId: 'det', templateVersion: '1.0.0', sourceProvider: 'gmail', extractedAt: new Date() },
    observedAt: new Date(), requiresHumanReview: false,
  }] as any;
  const result = await svc.infer('r1', facts);
  console.log('SPECIALIZATION:', JSON.stringify(result.specialization, null, 2));
  console.log('TECHDOMAINS:', JSON.stringify(result.technicalDomains, null, 2));
});
