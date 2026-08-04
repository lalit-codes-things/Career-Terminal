import { randomUUID } from 'crypto';
import type { FeedbackEntry, InferenceLogEntry } from '../../domain/recruiter-intelligence/ai-quality/contracts';

export class FeedbackPipelineService {
  private readonly feedback = new Map<string, FeedbackEntry[]>();
  private readonly inferenceLogs = new Map<string, InferenceLogEntry[]>();

  submitFeedback(entry: Omit<FeedbackEntry, 'feedbackId'>): FeedbackEntry {
    const feedbackId = randomUUID();
    const feedbackEntry: FeedbackEntry = {
      feedbackId,
      ...entry,
      timestamp: new Date(),
    };

    const existing = this.feedback.get(entry.extractionId) ?? [];
    existing.push(feedbackEntry);
    this.feedback.set(entry.extractionId, existing);

    return feedbackEntry;
  }

  getFeedback(extractionId: string): FeedbackEntry[] {
    return this.feedback.get(extractionId) ?? [];
  }

  getAllFeedback(): FeedbackEntry[] {
    return [...this.feedback.values()].flat();
  }

  getAverageRating(extractionId: string): number {
    const entries = this.feedback.get(extractionId);
    if (!entries || entries.length === 0) return 0;
    return entries.reduce((s, e) => s + e.rating, 0) / entries.length;
  }

  getFeedbackByReviewer(reviewerId: string): FeedbackEntry[] {
    return [...this.feedback.values()].flat().filter((f) => f.reviewerId === reviewerId);
  }

  logInference(entries: InferenceLogEntry[]): void {
    for (const entry of entries) {
      const existing = this.inferenceLogs.get(entry.extractionId) ?? [];
      existing.push(entry);
      this.inferenceLogs.set(entry.extractionId, existing);
    }
  }

  logInferenceEntry(entry: InferenceLogEntry): void {
    const existing = this.inferenceLogs.get(entry.extractionId) ?? [];
    existing.push(entry);
    this.inferenceLogs.set(entry.extractionId, existing);
  }

  getInferenceLogs(extractionId?: string): InferenceLogEntry[] {
    if (extractionId) {
      return this.inferenceLogs.get(extractionId) ?? [];
    }
    return [...this.inferenceLogs.values()].flat();
  }

  computeFeedbackSummary(): {
    totalFeedback: number;
    averageRating: number;
    feedbackByExtraction: number;
    positiveFeedback: number;
    negativeFeedback: number;
  } {
    const allFeedback = this.getAllFeedback();
    const totalFeedback = allFeedback.length;
    const averageRating = totalFeedback > 0
      ? allFeedback.reduce((s, f) => s + f.rating, 0) / totalFeedback
      : 0;
    const positiveFeedback = allFeedback.filter((f) => f.rating >= 4).length;
    const negativeFeedback = allFeedback.filter((f) => f.rating <= 2).length;

    return {
      totalFeedback,
      averageRating: Number(averageRating.toFixed(2)),
      feedbackByExtraction: this.feedback.size,
      positiveFeedback,
      negativeFeedback,
    };
  }
}