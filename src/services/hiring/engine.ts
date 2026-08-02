import { HiringSignal, HiringSignalEvidence } from './model';
import { HiringSignalRegistry } from './registry';

export class HiringAggregationEngine {
  constructor(private registry: HiringSignalRegistry) {}

  public aggregate(companyId: string, signalId: string, evidences: HiringSignalEvidence[]): HiringSignal {
    const def = this.registry.get(signalId);
    if (!def) {
      throw new Error(`Unknown hiring signal: ${signalId}`);
    }

    if (evidences.length === 0) {
      throw new Error('Cannot aggregate empty evidence list');
    }

    // Sort by timestamp descending
    const sorted = [...evidences].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Basic confidence aggregation: max confidence + small bump for multiple corroborated sources
    const maxConf = Math.max(...sorted.map(e => e.confidence));
    const uniqueSources = new Set(sorted.map(e => e.provider)).size;
    const aggregatedConfidence = Math.min(1.0, maxConf + (uniqueSources * 0.05));

    return {
      companyId,
      signalId,
      confidence: aggregatedConfidence,
      validFrom: sorted[sorted.length - 1]!.timestamp,
      validTo: sorted[0]!.timestamp, // Latest evidence defines end of known period
      evidence: sorted
    };
  }
}
