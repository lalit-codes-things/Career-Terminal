// Prompt 27 — Autonomous Recruiter Intelligence Contracts
import type { Citation } from '../copilot/contracts';

export type IntelligenceCategory =
  | 'opportunity'
  | 'risk'
  | 'relationship'
  | 'communication'
  | 'timing';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SuggestedAction {
  actionId: string;
  type: 'draft_message' | 'schedule_follow_up' | 'update_preferences' | 'verify_info';
  description: string;
  priority: 'low' | 'normal' | 'high';
  requiresUserApproval: true; // Strictly enforced
}

export interface ProactiveAlert {
  alertId: string;
  tenantId: string;
  recruiterId?: string;
  category: IntelligenceCategory;
  title: string;
  description: string;
  severity: AlertSeverity;
  confidence: number;
  citations: Citation[];
  suggestedActions: SuggestedAction[];
  detectedAt: Date;
}

export interface ContinuousIntelligenceEvent {
  eventId: string;
  tenantId: string;
  recruiterId: string;
  eventType: 'fact_added' | 'message_received' | 'timeline_updated' | 'graph_updated';
  payload: any;
  timestamp: Date;
}

export interface AutonomousMonitoringResult {
  tenantId: string;
  alertsGenerated: ProactiveAlert[];
  processedEventsCount: number;
  runAt: Date;
}
