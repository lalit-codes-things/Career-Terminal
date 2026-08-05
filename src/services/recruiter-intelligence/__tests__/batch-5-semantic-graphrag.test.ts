import { randomUUID } from 'crypto';
import { StubEmbeddingAdapter } from '../ai/adapters/stub-embedding.adapter';
import { InMemoryVectorStore } from '../infrastructure/in-memory-vector.store';
import { EmbeddingOrchestratorService } from '../semantic-representation/embedding-orchestrator.service';
import { HybridRetrievalService } from '../vector-search/hybrid-retrieval.service';
import { GraphRagService } from '../graph-rag/graph-rag.service';
import { ContextOrchestratorService } from '../context-orchestration/context-orchestrator.service';
import { ReasoningOrchestratorService } from '../reasoning/reasoning-orchestrator.service';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import { StubAiAdapter } from '../ai/adapters/stub.adapter';
import type { ContextItem, ContextOrchestrationRequest } from '../../../domain/recruiter-intelligence/context-orchestration/contracts';
import type { ReasoningWorkflow } from '../../../domain/recruiter-intelligence/reasoning-orchestrator/contracts';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';

describe('Epic 6 — Batch 5: Semantic Intelligence & GraphRAG', () => {
  let embeddingAdapter: StubEmbeddingAdapter;
  let vectorStore: InMemoryVectorStore;
  let embeddingOrchestrator: EmbeddingOrchestratorService;
  let hybridRetrieval: HybridRetrievalService;
  let pipeline: ExtractionPipeline;
  let graphRag: GraphRagService;
  let contextOrchestrator: ContextOrchestratorService;
  let reasoningOrchestrator: ReasoningOrchestratorService;

  beforeEach(() => {
    embeddingAdapter = new StubEmbeddingAdapter();
    vectorStore = new InMemoryVectorStore();
    embeddingOrchestrator = new EmbeddingOrchestratorService(embeddingAdapter, vectorStore);
    hybridRetrieval = new HybridRetrievalService(embeddingAdapter, vectorStore);
    
    const aiAdapter = new StubAiAdapter();
    pipeline = new ExtractionPipeline({ providers: [aiAdapter] });
    
    graphRag = new GraphRagService(hybridRetrieval, pipeline);
    contextOrchestrator = new ContextOrchestratorService();
    reasoningOrchestrator = new ReasoningOrchestratorService(pipeline);
  });

  describe('Prompt 21: Embedding Orchestrator', () => {
    it('should generate and store embeddings', async () => {
      const entityId = randomUUID();
      const embedding = await embeddingOrchestrator.embedAndStore({
        tenantId: 'tenant-1',
        entityId,
        entityType: 'recruiter_profile',
        text: 'Senior recruiter at Google specializing in AI',
      });

      expect(embedding.vector.length).toBe(384);
      expect(embedding.metadata.entityType).toBe('recruiter_profile');
      
      const searchRes = await vectorStore.search({ vector: embedding.vector, topK: 1 });
      expect(searchRes.length).toBe(1);
      expect(searchRes[0]!.entityId).toBe(entityId);
    });

    it('should embed in batches', async () => {
      const res = await embeddingOrchestrator.embedBatch([
        { tenantId: 't1', entityId: 'e1', entityType: 'skill', text: 'TypeScript' },
        { tenantId: 't1', entityId: 'e2', entityType: 'skill', text: 'Python' },
      ]);

      expect(res.successful).toBe(2);
      expect(res.failed).toBe(0);
      expect(res.embeddings.length).toBe(2);
    });
  });

  describe('Prompt 22: Hybrid Retrieval', () => {
    beforeEach(async () => {
      await embeddingOrchestrator.embedBatch([
        { tenantId: 't1', entityId: 'rec-1', entityType: 'recruiter_profile', text: 'Looking for a senior frontend developer with React experience.' },
        { tenantId: 't1', entityId: 'rec-2', entityType: 'recruiter_profile', text: 'Hiring backend engineers. Python and AWS are required.' },
      ]);
    });

    it('should retrieve relevant items using vector search', async () => {
      const queryVector = await embeddingAdapter.embedContext('I need a frontend react dev');
      
      const results = await hybridRetrieval.search({
        vectorQuery: { vector: queryVector, topK: 2 },
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.vectorScore).toBeGreaterThan(0);
    });

    it('should perform hybrid search combining text and vector', async () => {
      const queryVector = await embeddingAdapter.embedContext('Python backend');
      
      const results = await hybridRetrieval.search({
        textQuery: 'Python backend',
        vectorQuery: { vector: queryVector, topK: 2 },
        weights: { text: 0.5, vector: 0.5 },
      });

      expect(results.length).toBe(2);
      expect(results[0]!.hybridScore).toBeGreaterThan(0);
      expect(results[0]!.textScore).toBeGreaterThanOrEqual(0); // Keyword score
    });
  });

  describe('Prompt 23: GraphRAG Foundation', () => {
    it('should answer questions using graph traversal and semantic context', async () => {
      // Seed some semantic context
      await embeddingOrchestrator.embedAndStore({
        tenantId: 't1',
        entityId: 'rec-1',
        entityType: 'recruiter_profile',
        text: 'The recruiter is looking for machine learning engineers.',
      });

      const structuredFacts: RecruiterEntityFact[] = [
        {
          factId: randomUUID(),
          recruiterId: 'rec-1',
          sourceMessageId: 'msg1',
          fieldType: 'compensation_mention',
          rawValue: '$200k base',
          normalizedValue: '200000',
          structuredValue: { amount: 200000, currency: 'USD' },
          confidence: 0.9,
          confidenceBand: 'high',
          evidence: { messageId: 'msg1', excerpt: 'Base salary is $200k' },
          provenance: {
            extractor: 'test',
            method: 'deterministic',
            provider: 'none',
            model: 'regex',
            templateId: 'test',
            templateVersion: '1.0.0',
            sourceProvider: 'gmail',
            extractedAt: new Date(),
          },
          observedAt: new Date(),
          requiresHumanReview: false,
        }
      ];

      const response = await graphRag.answer({
        tenantId: 't1',
        queryText: 'What are they hiring for and what is the salary?',
        queryVector: await embeddingAdapter.embedContext('What are they hiring for and what is the salary?'),
        traversalConfig: { maxDepth: 1, semanticThreshold: 0.0 },
        requireEvidence: true,
        structuredFacts,
      });

      expect(response.answerText).toBeTruthy();
      expect(response.evidence.length).toBeGreaterThan(0);
      
      const hasSemanticEvidence = response.evidence.some(e => e.sourceType === 'vector');
      const hasFactEvidence = response.evidence.some(e => e.sourceType === 'structured_fact');
      
      expect(hasSemanticEvidence).toBe(true);
      expect(hasFactEvidence).toBe(true);
      expect(response.contextUsed.subgraph.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('Prompt 24: Context Orchestration Engine', () => {
    it('should assemble, deduplicate, and token-optimize context', async () => {
      const rawItems: ContextItem[] = [
        { itemId: '1', sourceType: 'memory', content: 'Prefers email.', relevanceScore: 0.9, tokenCount: 10 },
        { itemId: '2', sourceType: 'observation', content: 'Prefers email.', relevanceScore: 0.8, tokenCount: 10 }, // Duplicate
        { itemId: '3', sourceType: 'timeline', content: 'Sent message yesterday.', relevanceScore: 0.5, tokenCount: 20 },
        { itemId: '4', sourceType: 'structured_fact', content: 'Is hiring for engineering.', relevanceScore: 0.95, tokenCount: 15 },
      ];

      const request: ContextOrchestrationRequest = {
        tenantId: 't1',
        query: 'What is their preference?',
        maxTokens: 30, // Force compression/exclusion
        prioritizedSources: ['structured_fact'],
      };

      const result = await contextOrchestrator.orchestrate(request, rawItems);

      expect(result.itemsIncluded.length).toBeLessThan(rawItems.length); // Should drop some due to token limits and dupes
      expect(result.totalTokens).toBeLessThanOrEqual(30);
      expect(result.assembledPromptText).toContain('SOURCE: STRUCTURED_FACT');
      expect(result.compressionRatio).toBeLessThan(1.0);
    });
  });

  describe('Prompt 25: AI Reasoning Orchestrator', () => {
    it('should orchestrate multi-step iterative reasoning', async () => {
      const workflow: ReasoningWorkflow = {
        workflowId: 'wf-1',
        strategy: 'multi_step',
        timeoutMs: 5000,
        steps: [
          { stepId: 'step-1', description: 'Analyze intent', expectedOutputSchema: {} },
          { stepId: 'step-2', description: 'Formulate strategy based on intent', expectedOutputSchema: {} },
        ]
      };

      const result = await reasoningOrchestrator.executeWorkflow(workflow, { tenantId: 't1', someFact: 'test' });

      expect(result.stepResults.length).toBe(2);
      expect(result.stepResults[0]!.stepId).toBe('step-1');
      expect(result.stepResults[1]!.stepId).toBe('step-2');
      expect(result.overallConfidence).toBeGreaterThan(0);
      expect(result.totalLatencyMs).toBeGreaterThan(0);
      expect(result.finalOutput).toBeDefined();
    });
  });
});
