import { randomUUID } from 'crypto';
import type { CopilotConversation, CopilotIntent, CopilotQueryOptions, CopilotResponse, Citation } from '../../../domain/recruiter-intelligence/copilot/contracts';
import type { GraphRagService } from '../graph-rag/graph-rag.service';
import type { ContextOrchestratorService } from '../context-orchestration/context-orchestrator.service';
import type { ReasoningOrchestratorService } from '../reasoning/reasoning-orchestrator.service';
import type { ReasoningWorkflow } from '../../../domain/recruiter-intelligence/reasoning-orchestrator/contracts';
import type { GraphRagRequest } from '../../../domain/recruiter-intelligence/graph-rag/contracts';

/**
 * RecruiterCopilotService —  implementation.
 *
 * Implements an intelligent conversational assistant (Copilot).
 * Understands recruiter context using GraphRAG, memory, and orchestrated context.
 * Performs reasoning and provides evidence-backed responses.
 */
export class RecruiterCopilotService {
  constructor(
    private readonly graphRag: GraphRagService,
    _contextOrchestrator: ContextOrchestratorService,
    private readonly reasoningOrchestrator: ReasoningOrchestratorService,
  ) {}

  /**
   * Processes a user message and returns a context-aware, evidence-backed response.
   */
  async ask(
    conversation: CopilotConversation,
    userQuery: string,
    options?: CopilotQueryOptions,
  ): Promise<CopilotResponse> {
    const tenantId = conversation.tenantId;

    // 1. Analyze intent (simulate with a quick reasoning step)
    const intentWorkflow: ReasoningWorkflow = {
      workflowId: randomUUID(),
      strategy: 'single_step',
      timeoutMs: 5000,
      steps: [
        {
          stepId: 'detect-intent',
          description: 'Detect user intent from query',
          expectedOutputSchema: { type: 'object', properties: { intent: { type: 'string' } } },
        },
      ],
    };

    const intentResult = await this.reasoningOrchestrator.executeWorkflow<{ intent: string }>(
      intentWorkflow,
      { tenantId, query: userQuery }
    );

    // Map to known intent
    const detectedIntent: CopilotIntent = ['summarize_recruiter', 'analyze_relationship', 'compare_recruiters', 'extract_insights'].includes(intentResult.finalOutput?.intent)
      ? (intentResult.finalOutput.intent as CopilotIntent)
      : 'general_query';

    // 2. Retrieve evidence and expand context using GraphRAG
    const ragRequest: GraphRagRequest = {
      tenantId,
      queryText: userQuery,
      traversalConfig: { maxDepth: 1, semanticThreshold: 0.5 },
      requireEvidence: options?.requireEvidence ?? true,
      structuredFacts: [],
    };
    // Mock facts injection; in reality, we'd fetch actual facts based on the query or conversation.recruiterId
    const ragResponse = await this.graphRag.answer(ragRequest);

    // 3. Orchestrate final reasoning (Copilot response generation)
    const responseWorkflow: ReasoningWorkflow = {
      workflowId: randomUUID(),
      strategy: 'multi_step',
      timeoutMs: 15000,
      steps: [
        {
          stepId: 'generate-response',
          description: 'Generate helpful conversational response based on GraphRAG context',
          expectedOutputSchema: {
            type: 'object',
            properties: {
              answerText: { type: 'string' },
              suggestedFollowUps: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      ],
    };

    const reasoningResponse = await this.reasoningOrchestrator.executeWorkflow<{ answerText: string; suggestedFollowUps: string[] }>(
      responseWorkflow,
      {
        tenantId,
        query: userQuery,
        conversationHistory: conversation.messages.slice(-5), // Recent memory
        graphRagContext: ragResponse.answerText, // Passing GraphRAG pre-synthesized answer as context
        evidence: ragResponse.evidence,
      }
    );

    // 4. Assemble final response with citations
    const citations: Citation[] = ragResponse.evidence.map(e => ({
      citationId: randomUUID(),
      sourceType: e.sourceType,
      excerpt: e.excerpt,
      relevanceScore: e.relevanceScore,
    }));

    return {
      responseId: randomUUID(),
      conversationId: conversation.conversationId,
      answerText: reasoningResponse.finalOutput?.answerText || 'I could not generate an answer based on the current context.',
      intentDetected: detectedIntent,
      confidence: reasoningResponse.overallConfidence,
      citations,
      contextUsed: ragResponse.contextUsed,
      suggestedFollowUps: reasoningResponse.finalOutput?.suggestedFollowUps || [],
      generatedAt: new Date(),
    };
  }
}
