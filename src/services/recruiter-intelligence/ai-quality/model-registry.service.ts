import { randomUUID } from 'crypto';
import type { ModelEntry, ModelEvaluation, EvaluationDimension, EvaluationResult } from '../../domain/recruiter-intelligence/ai-quality/contracts';

export class ModelRegistryService {
  private readonly models = new Map<string, ModelEntry>();
  private readonly evaluations = new Map<string, ModelEvaluation>();

  register(entry: ModelEntry): void {
    this.models.set(entry.modelId, entry);
  }

  get(modelId: string): ModelEntry | undefined {
    return this.models.get(modelId);
  }

  getAll(): ModelEntry[] {
    return [...this.models.values()];
  }

  update(modelId: string, updates: Partial<ModelEntry>): ModelEntry | null {
    const existing = this.models.get(modelId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.models.set(modelId, updated);
    return updated;
  }

  setActive(modelId: string): ModelEntry | null {
    const existing = this.models.get(modelId);
    if (!existing) return null;
    for (const [, model] of this.models) {
      model.isActive = model.modelId === modelId;
    }
    existing.isActive = true;
    return existing;
  }

  recordEvaluation(evaluation: ModelEvaluation): void {
    this.evaluations.set(evaluation.evaluationId, evaluation);
  }

  getEvaluations(modelId?: string): ModelEvaluation[] {
    if (!modelId) return [...this.evaluations.values()];
    return [...this.evaluations.values()].filter((e) => e.modelId === modelId);
  }

  getBestModel(templateId: string, dimension: EvaluationDimension): ModelEntry | null {
    let bestModel: ModelEntry | null = null;
    let bestScore = -Infinity;

    for (const [, model] of this.models) {
      const evals = [...this.evaluations.values()].filter(
        (e) => e.modelId === model.modelId && e.templateId === templateId,
      );
      const relevantResults = evals.flatMap((e) =>
        [...e.results.values()].filter((r) => r.dimension === dimension),
      );

      if (relevantResults.length > 0) {
        const avgScore = relevantResults.reduce((s, r) => s + r.score, 0) / relevantResults.length;
        if (avgScore > bestScore) {
          bestScore = avgScore;
          bestModel = model;
        }
      }
    }

    return bestModel;
  }
}