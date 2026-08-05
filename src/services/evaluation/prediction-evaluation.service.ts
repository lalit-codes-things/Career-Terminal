/**
 * PredictionEvaluationService
 *
 * Accuracy and confidence-calibration reporting built entirely on top of
 * the Prediction and PredictionFeedback tables — no new AIEvaluation table.
 *
 * Reports:
 *   accuracyReport()         — per-capability accuracy, precision, recall
 *   calibrationReport()      — reliability diagram buckets (expected vs actual)
 *   costReport()             — total/average token cost by provider/capability
 *   reviewQueueStats()       — how many predictions need human review
 *   predictionHistory()      — paginated prediction history for a user/entity
 */

import { prisma } from '../../config/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccuracyReport {
  capability: string;
  totalPredictions: number;
  evaluated: number;
  correct: number;
  accuracy: number;
  averageConfidence: number;
  /** Brier score: mean squared error between confidence and outcome (0=perfect) */
  brierScore: number;
}

export interface CalibrationBucket {
  bucket: string;           // e.g. "0.8-0.9"
  lowerBound: number;
  upperBound: number;
  count: number;
  expectedAccuracy: number; // midpoint of bucket
  actualAccuracy: number;   // fraction correct in this bucket
  calibrationError: number; // |expected - actual|
}

export interface CalibrationReport {
  buckets: CalibrationBucket[];
  /** Expected Calibration Error — weighted average of per-bucket calibration error */
  ece: number;
  totalEvaluated: number;
}

export interface CostReport {
  byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>;
  byCapability: Record<string, { calls: number; estimatedCostUsd: number; avgLatencyMs: number }>;
  totalCostUsd: number;
  totalCalls: number;
  periodDays: number;
}

export interface ReviewQueueStats {
  total: number;
  requiresReview: number;
  reviewRate: number;
  byCapability: Record<string, number>;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class PredictionEvaluationService {
  /**
   * Per-capability accuracy report.
   * Only counts predictions that have been evaluated (isCorrect is not null).
   */
  async accuracyReport(options: {
    userId?: string;
    capability?: string;
    sinceDate?: Date;
  } = {}): Promise<AccuracyReport[]> {
    const where = this.buildWhereClause(options);

    const predictions = await prisma.prediction.findMany({
      where: { ...where, isCorrect: { not: null } },
      select: {
        capability: true,
        confidenceScore: true,
        isCorrect: true,
      },
    });

    // Group by capability
    const groups = new Map<string, { total: number; correct: number; confidenceSum: number; brierSum: number }>();

    for (const p of predictions) {
      const cap = p.capability ?? 'unknown';
      const existing = groups.get(cap) ?? { total: 0, correct: 0, confidenceSum: 0, brierSum: 0 };
      existing.total++;
      if (p.isCorrect) existing.correct++;
      existing.confidenceSum += p.confidenceScore;
      // Brier score component: (confidence - outcome)^2
      const outcome = p.isCorrect ? 1 : 0;
      existing.brierSum += Math.pow(p.confidenceScore - outcome, 2);
      groups.set(cap, existing);
    }

    // Also count total predictions (including non-evaluated) per capability
    const totalPerCap = await prisma.prediction.groupBy({
      by: ['capability'],
      where,
      _count: { id: true },
    });
    const totalMap = new Map(totalPerCap.map((r) => [r.capability ?? 'unknown', r._count.id]));

    return [...groups.entries()].map(([capability, stats]) => ({
      capability,
      totalPredictions: totalMap.get(capability) ?? stats.total,
      evaluated: stats.total,
      correct: stats.correct,
      accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
      averageConfidence: stats.total > 0 ? stats.confidenceSum / stats.total : 0,
      brierScore: stats.total > 0 ? stats.brierSum / stats.total : 0,
    })).sort((a, b) => b.totalPredictions - a.totalPredictions);
  }

  /**
   * Reliability diagram data — groups evaluated predictions into confidence
   * buckets and compares expected vs actual accuracy.
   */
  async calibrationReport(options: {
    userId?: string;
    capability?: string;
    sinceDate?: Date;
    bucketCount?: number;
  } = {}): Promise<CalibrationReport> {
    const bucketCount = options.bucketCount ?? 10;
    const where = this.buildWhereClause(options);

    const predictions = await prisma.prediction.findMany({
      where: { ...where, isCorrect: { not: null } },
      select: { confidenceScore: true, isCorrect: true },
    });

    const bucketSize = 1 / bucketCount;
    const buckets: Map<number, { count: number; correct: number }> = new Map();

    for (let i = 0; i < bucketCount; i++) {
      buckets.set(i, { count: 0, correct: 0 });
    }

    for (const p of predictions) {
      const bucketIdx = Math.min(Math.floor(p.confidenceScore / bucketSize), bucketCount - 1);
      const bucket = buckets.get(bucketIdx)!;
      bucket.count++;
      if (p.isCorrect) bucket.correct++;
    }

    const totalEvaluated = predictions.length;
    let weightedCalibError = 0;

    const bucketResults: CalibrationBucket[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const lower = i * bucketSize;
      const upper = lower + bucketSize;
      const mid = lower + bucketSize / 2;
      const { count, correct } = buckets.get(i)!;
      const actualAccuracy = count > 0 ? correct / count : 0;
      const calibError = Math.abs(mid - actualAccuracy);

      weightedCalibError += (count / Math.max(totalEvaluated, 1)) * calibError;

      bucketResults.push({
        bucket: `${(lower * 100).toFixed(0)}-${(upper * 100).toFixed(0)}%`,
        lowerBound: lower,
        upperBound: upper,
        count,
        expectedAccuracy: mid,
        actualAccuracy,
        calibrationError: calibError,
      });
    }

    return {
      buckets: bucketResults.filter((b) => b.count > 0),
      ece: weightedCalibError,
      totalEvaluated,
    };
  }

  /**
   * Token/cost breakdown by provider and capability.
   */
  async costReport(options: {
    userId?: string;
    sinceDate?: Date;
    periodDays?: number;
  } = {}): Promise<CostReport> {
    const periodDays = options.periodDays ?? 30;
    const since = options.sinceDate ?? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const predictions = await prisma.prediction.findMany({
      where: {
        ...(options.userId ? { userId: options.userId } : {}),
        timestamp: { gte: since },
        estimatedCostUsd: { not: null },
      },
      select: {
        capability: true,
        provider: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
        latencyMs: true,
      },
    });

    const byProvider: CostReport['byProvider'] = {};
    const byCapability: CostReport['byCapability'] = {};
    let totalCostUsd = 0;

    for (const p of predictions) {
      const prov = p.provider ?? 'unknown';
      const cap = p.capability ?? 'unknown';
      const cost = p.estimatedCostUsd ?? 0;
      totalCostUsd += cost;

      // Provider aggregation
      if (!byProvider[prov]) byProvider[prov] = { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
      byProvider[prov]!.calls++;
      byProvider[prov]!.inputTokens += p.inputTokens ?? 0;
      byProvider[prov]!.outputTokens += p.outputTokens ?? 0;
      byProvider[prov]!.estimatedCostUsd += cost;

      // Capability aggregation
      if (!byCapability[cap]) byCapability[cap] = { calls: 0, estimatedCostUsd: 0, avgLatencyMs: 0 };
      byCapability[cap]!.calls++;
      byCapability[cap]!.estimatedCostUsd += cost;
      byCapability[cap]!.avgLatencyMs += p.latencyMs ?? 0;
    }

    // Finalize averages
    for (const cap of Object.values(byCapability)) {
      cap.avgLatencyMs = cap.calls > 0 ? Math.round(cap.avgLatencyMs / cap.calls) : 0;
      cap.estimatedCostUsd = Number(cap.estimatedCostUsd.toFixed(6));
    }

    return {
      byProvider,
      byCapability,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalCalls: predictions.length,
      periodDays,
    };
  }

  /**
   * Human review queue statistics.
   */
  async reviewQueueStats(options: { userId?: string } = {}): Promise<ReviewQueueStats> {
    const where = options.userId ? { userId: options.userId } : {};

    const [total, requiresReview, byCapabilityRaw] = await Promise.all([
      prisma.prediction.count({ where }),
      prisma.prediction.count({ where: { ...where, requiresReview: true } }),
      prisma.prediction.groupBy({
        by: ['capability'],
        where: { ...where, requiresReview: true },
        _count: { id: true },
      }),
    ]);

    const byCapability: Record<string, number> = {};
    for (const row of byCapabilityRaw) {
      byCapability[row.capability ?? 'unknown'] = row._count.id;
    }

    return {
      total,
      requiresReview,
      reviewRate: total > 0 ? requiresReview / total : 0,
      byCapability,
    };
  }

  /**
   * Paginated prediction history for audit / UI.
   */
  async predictionHistory(options: {
    userId?: string;
    entityId?: string;
    capability?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const page = options.page ?? 1;
    const pageSize = Math.min(options.pageSize ?? 20, 100);

    const where = {
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.entityId
        ? {
            OR: [
              { recruiterId: options.entityId },
              { applicationId: options.entityId },
              { opportunityId: options.entityId },
            ],
          }
        : {}),
      ...(options.capability ? { capability: options.capability } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.prediction.findMany({
        where,
        select: {
          id: true,
          capability: true,
          predictionType: true,
          confidenceScore: true,
          confidenceBand: true,
          provider: true,
          isCorrect: true,
          requiresReview: true,
          estimatedCostUsd: true,
          latencyMs: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.prediction.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildWhereClause(options: {
    userId?: string;
    capability?: string;
    sinceDate?: Date;
  }) {
    return {
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.capability ? { capability: options.capability } : {}),
      ...(options.sinceDate ? { timestamp: { gte: options.sinceDate } } : {}),
    };
  }
}

export const predictionEvaluationService = new PredictionEvaluationService();
