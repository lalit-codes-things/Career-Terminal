import { randomUUID } from 'crypto';
import type { ContinuousIntelligenceEvent, ProactiveAlert, AutonomousMonitoringResult, SuggestedAction } from '../../../domain/recruiter-intelligence/autonomous-intelligence/contracts';
import type { ReasoningOrchestratorService } from '../reasoning/reasoning-orchestrator.service';
import type { ReasoningWorkflow } from '../../../domain/recruiter-intelligence/reasoning-orchestrator/contracts';

/**
 * AutonomousIntelligenceService —  implementation.
 *
 * Proactive AI intelligence pipeline. Continuously monitors events and generates
 * alerts, recommendations, and insights.
 * Never performs autonomous external actions (read-only/recommendation-only).
 */
export class AutonomousIntelligenceService {
  constructor(
    private readonly reasoningOrchestrator: ReasoningOrchestratorService,
  ) {}

  /**
   * Processes a batch of events and generates proactive intelligence.
   * In a real system, this would be triggered by a message queue or event bus.
   */
  async processEvents(
    tenantId: string,
    events: ContinuousIntelligenceEvent[],
  ): Promise<AutonomousMonitoringResult> {
    const alerts: ProactiveAlert[] = [];

    // Group events by recruiter for batch reasoning
    const eventsByRecruiter = new Map<string, ContinuousIntelligenceEvent[]>();
    for (const e of events) {
      if (!e.recruiterId) continue;
      const list = eventsByRecruiter.get(e.recruiterId) || [];
      list.push(e);
      eventsByRecruiter.set(e.recruiterId, list);
    }

    for (const [recruiterId, recruiterEvents] of eventsByRecruiter.entries()) {
      // 1. Analyze events for proactive alerts
      const analysisWorkflow: ReasoningWorkflow = {
        workflowId: randomUUID(),
        strategy: 'single_step',
        timeoutMs: 10000,
        steps: [
          {
            stepId: 'analyze-events',
            description: 'Analyze recent recruiter events for risks or opportunities',
            expectedOutputSchema: {
              type: 'object',
              properties: {
                alerts: { type: 'array' },
              },
            },
          },
        ],
      };

      try {
        const result = await this.reasoningOrchestrator.executeWorkflow<{ alerts: any[] }>(
          analysisWorkflow,
          { tenantId, recruiterId, recentEvents: recruiterEvents }
        );

        // Map AI output to structured ProactiveAlerts
        if (result.finalOutput?.alerts && Array.isArray(result.finalOutput.alerts)) {
          for (const a of result.finalOutput.alerts) {

            const actions: SuggestedAction[] = (a.suggestedActions || []).map((sa: any) => ({
              actionId: randomUUID(),
              type: sa.type || 'draft_message',
              description: sa.description || 'Action required',
              priority: sa.priority || 'normal',
              requiresUserApproval: true, // Strictly enforced domain rule
            }));

            alerts.push({
              alertId: randomUUID(),
              tenantId,
              recruiterId,
              category: a.category || 'relationship',
              title: a.title || 'Insight Detected',
              description: a.description || 'A change in recruiter behavior or opportunity was detected.',
              severity: a.severity || 'low',
              confidence: result.overallConfidence,
              citations: [], // Ideally populated from evidence
              suggestedActions: actions,
              detectedAt: new Date(),
            });
          }
        }
      } catch (err) {
        console.error(`Failed to process events for recruiter ${recruiterId}`, err);
      }
    }

    return {
      tenantId,
      alertsGenerated: alerts.sort((a, b) => {
        const severityMap = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
        return severityMap[b.severity] - severityMap[a.severity];
      }),
      processedEventsCount: events.length,
      runAt: new Date(),
    };
  }
}
