import type { ExtractionOutput, HumanReviewHook, HumanReviewRequest } from './types';
import { randomUUID } from 'crypto';

/**
 * InMemoryHumanReviewQueue — collects extractions that need human review.
 * In production this would push to a BullMQ queue or a dedicated review table.
 * The pipeline calls this hook automatically whenever confidence is below threshold
 * or flagged fields are found.
 */
export class InMemoryHumanReviewQueue implements HumanReviewHook {
  private readonly pending: HumanReviewRequest[] = [];

  /** Confidence threshold below which an extraction is auto-flagged for review. */
  private readonly confidenceThreshold: number;

  constructor(options: { confidenceThreshold?: number } = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? 0.55;
  }

  async queue(request: HumanReviewRequest): Promise<void> {
    this.pending.push(request);
  }

  isReviewRequired(output: ExtractionOutput): boolean {
    if (output.overallConfidence < this.confidenceThreshold) return true;
    if (output.requiresHumanReview) return true;

    // Check individual fields for low-confidence values
    const lowConfidenceFields = output.fields.filter((f) => f.confidence < this.confidenceThreshold);
    if (lowConfidenceFields.length > output.fields.length * 0.5) return true;

    return false;
  }

  buildReviewRequest(output: ExtractionOutput, reason: string): HumanReviewRequest {
    const flaggedFields = output.fields
      .filter((f) => f.confidence < this.confidenceThreshold)
      .map((f) => f.field);

    return {
      reviewId: randomUUID(),
      extractionId: output.extractionId,
      reason,
      flaggedFields,
      extractedData: Object.fromEntries(output.fields.map((f) => [f.field, f.value])),
      confidence: output.overallConfidence,
      queuedAt: new Date(),
    };
  }

  pendingCount(): number {
    return this.pending.length;
  }

  drain(): HumanReviewRequest[] {
    return this.pending.splice(0);
  }

  peek(): readonly HumanReviewRequest[] {
    return [...this.pending];
  }
}
