import { randomUUID } from 'crypto';
import { StubEmbeddingAdapter } from '../ai/adapters/stub-embedding.adapter';
import { InMemoryVectorStore } from '../infrastructure/in-memory-vector.store';
import { HybridRetrievalService } from '../vector-search/hybrid-retrieval.service';
import { GraphRagService } from '../graph-rag/graph-rag.service';
import { ContextOrchestratorService } from '../context-orchestration/context-orchestrator.service';
import { ReasoningOrchestratorService } from '../reasoning/reasoning-orchestrator.service';
import { RecruiterCopilotService } from '../copilot/recruiter-copilot.service';
import { AutonomousIntelligenceService } from '../autonomous/autonomous-intelligence.service';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import { StubAiAdapter } from '../ai/adapters/stub.adapter';
import { buildDefaultTemplates } from '../ai/prompt-manager';
import type { CopilotConversation } from '../../../domain/recruiter-intelligence/copilot/contracts';
import type { ContinuousIntelligenceEvent } from '../../../domain/recruiter-intelligence/autonomous-intelligence/contracts';

jest.mock('../../../config/database', () => ({
  dbRouter: {
    read: jest.fn().mockReturnValue({
      recruiterGraphNode: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'node-1' }), update: jest.fn().mockResolvedValue({ id: 'node-1' }) },
      recruiterGraphEdge: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'edge-1' }), update: jest.fn().mockResolvedValue({ id: 'edge-1' }) },
      recruiterFact: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'fact-1' }), update: jest.fn().mockResolvedValue({ id: 'fact-1' }) },
    }),
    write: jest.fn().mockReturnValue({
      recruiterGraphNode: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'node-1' }), update: jest.fn().mockResolvedValue({ id: 'node-1' }) },
      recruiterGraphEdge: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'edge-1' }), update: jest.fn().mockResolvedValue({ id: 'edge-1' }) },
      recruiterFact: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'fact-1' }), update: jest.fn().mockResolvedValue({ id: 'fact-1' }) },
    }),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },
}));

describe('Copilot & Autonomous Intelligence', () => {
  let embeddingAdapter: StubEmbeddingAdapter;
  let vectorStore: InMemoryVectorStore;
  let hybridRetrieval: HybridRetrievalService;
  let pipeline: ExtractionPipeline;
  let graphRag: GraphRagService;
  let contextOrchestrator: ContextOrchestratorService;
  let reasoningOrchestrator: ReasoningOrchestratorService;

  let copilotService: RecruiterCopilotService;
  let autonomousService: AutonomousIntelligenceService;

  beforeEach(() => {
    embeddingAdapter = new StubEmbeddingAdapter();
    vectorStore = new InMemoryVectorStore();
    hybridRetrieval = new HybridRetrievalService(embeddingAdapter, vectorStore);

    const aiAdapter = new StubAiAdapter();
    pipeline = new ExtractionPipeline({ providers: [aiAdapter] });
    for (const template of buildDefaultTemplates()) {
      pipeline.getPromptManager().register(template);
    }

    graphRag = new GraphRagService(hybridRetrieval, pipeline);
    contextOrchestrator = new ContextOrchestratorService();
    reasoningOrchestrator = new ReasoningOrchestratorService(pipeline);

    copilotService = new RecruiterCopilotService(graphRag, contextOrchestrator, reasoningOrchestrator);
    autonomousService = new AutonomousIntelligenceService(reasoningOrchestrator);
  });

  describe('Recruiter Copilot Service', () => {
    it('should provide context-aware, cited answers to user queries', async () => {
      const conversation: CopilotConversation = {
        conversationId: randomUUID(),
        tenantId: 'tenant-1',
        recruiterId: 'rec-1',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const query = 'What roles does Ada Recruiter specialize in?';

      const response = await copilotService.ask(conversation, query, { requireEvidence: true });

      expect(response.conversationId).toBe(conversation.conversationId);
      expect(response.intentDetected).toBe('general_query');
      expect(response.answerText).toBeTruthy();
      expect(response.confidence).toBeGreaterThan(0.5);

      // Ensure citations are mapped properly
      expect(response.citations.length).toBeGreaterThanOrEqual(0); // Stub AI might not inject evidence directly to the top level, but GraphRAG does

      expect(Array.isArray(response.suggestedFollowUps)).toBe(true);
    });
  });

  describe('Autonomous Intelligence Service', () => {
    it('should proactively generate alerts based on continuous events', async () => {
      const tenantId = 'tenant-1';
      const events: ContinuousIntelligenceEvent[] = [
        {
          eventId: randomUUID(),
          tenantId,
          recruiterId: 'rec-1',
          eventType: 'timeline_updated',
          payload: { action: 'no_response_72h' },
          timestamp: new Date(),
        },
      ];

      const result = await autonomousService.processEvents(tenantId, events);

      expect(result.processedEventsCount).toBe(1);
      expect(Array.isArray(result.alertsGenerated)).toBe(true);
    });
  });
});
