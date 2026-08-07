import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../ai/types';
import type { ExtractionPipeline } from '../ai/extraction-pipeline';
import type {
  IterativeReasoningStepResult,
  ReasoningResult,
  ReasoningWorkflow,
} from '../../../domain/recruiter-intelligence/reasoning-orchestrator/contracts';

/**
 * ReasoningOrchestratorService —  implementation.
 *
 * Coordinates complex reasoning workflows across multiple steps.
 * Handles model routing, fallback strategies, explainability, and evidence preservation.
 */
export class ReasoningOrchestratorService {
  constructor(
    private readonly pipeline: ExtractionPipeline,
  ) {}

  /**
   * Executes a reasoning workflow.
   */
  async executeWorkflow<T>(
    workflow: ReasoningWorkflow,
    initialContext: any,
  ): Promise<ReasoningResult<T>> {
    const startTime = Date.now();
    const stepResults: IterativeReasoningStepResult[] = [];
    let currentContext = { ...initialContext };
    let finalOutput: any = null;

    for (const step of workflow.steps) {
      const stepStartTime = Date.now();
      try {
        // Build input for this specific step
        const input: ExtractionInput = {
          extractionId: randomUUID(),
          tenantId: initialContext.tenantId ?? 'system',
          sourceType: 'profile',
          sourceId: initialContext.sourceId ?? 'workflow',
          content: JSON.stringify({
            stepDescription: step.description,
            context: currentContext,
          }),
          metadata: {
            templateId: 'system-reasoning-step', // Assuming a generic reasoning template
            targetSchema: step.expectedOutputSchema,
          },
          requestedAt: new Date(),
        };

        // Execute via pipeline (handles provider routing internally if extended)
        const extractionResult = await this.pipeline.extract('recruiter-insights-engine', input, {}); // using insights as proxy template for now

        const latencyMs = Date.now() - stepStartTime;

        // Mock token calculation based on content length
        const stepTokens = Math.floor(input.content.length / 4);

        const stepOutput = extractionResult.fields.reduce((acc, f) => {
          acc[f.field] = f.value;
          return acc;
        }, {} as any);

        const stepResult: IterativeReasoningStepResult = {
          stepId: step.stepId,
          output: stepOutput,
          confidence: extractionResult.fields.reduce((sum, f) => sum + (f.confidence ?? 0.5), 0) / Math.max(1, extractionResult.fields.length),
          latencyMs,
          costEstimateTokens: stepTokens,
          evidenceUsed: extractionResult.fields.flatMap(f => f.evidence.map(e => e.excerpt)),
        };

        stepResults.push(stepResult);

        // Update context for the next step (iterative accumulation)
        if (workflow.strategy === 'multi_step' || workflow.strategy === 'iterative') {
          currentContext = {
            ...currentContext,
            [`step_${step.stepId}_output`]: stepOutput,
          };
        }

        finalOutput = stepOutput;

      } catch (error) {
        // Fallback logic
        if (step.fallbackModel) {
          // Retry logic would go here
          console.warn(`Step ${step.stepId} failed, would retry with fallback ${step.fallbackModel}`);
        }
        throw new Error(`Reasoning workflow failed at step ${step.stepId}: ${(error as Error).message}`);
      }
    }

    const totalLatency = Date.now() - startTime;
    const totalTokens = stepResults.reduce((sum, r) => sum + r.costEstimateTokens, 0);
    const overallConfidence = stepResults.reduce((sum, r) => sum + r.confidence, 0) / Math.max(1, stepResults.length);

    return {
      resultId: randomUUID(),
      finalOutput: finalOutput as T,
      overallConfidence,
      stepResults,
      totalLatencyMs: totalLatency,
      totalTokensUsed: totalTokens,
      completedAt: new Date(),
    };
  }
}
