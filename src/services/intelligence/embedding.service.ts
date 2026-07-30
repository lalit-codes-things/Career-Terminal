/**
 * EmbeddingService — Section 38 embedding lifecycle.
 *
 * Provides the abstraction for generating and storing embeddings used in
 * skill and resume matching.  The actual embedding model and storage
 * are injected at runtime so the service remains testable and swappable.
 *
 * This is an additive service stub preserving existing behaviour.
 */

export interface EmbeddingVector {
  readonly dimensions: number;
  readonly values: readonly number[];
}

export interface EmbeddingInput {
  readonly userId: string;
  readonly targetId: string;
  readonly targetType: 'RESUME' | 'SKILL' | 'OPPORTUNITY' | 'ROLE';
  readonly text: string;
  readonly modelVersion: string;
}

export interface EmbeddingRecord {
  readonly id: string;
  readonly userId: string;
  readonly targetId: string;
  readonly targetType: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  readonly vector: readonly number[];
  readonly createdAt: Date;
}

export class EmbeddingService {
  constructor(private readonly embeddingModel?: (text: string) => Promise<EmbeddingVector>) {}

  async generate(input: EmbeddingInput): Promise<EmbeddingRecord> {
    const vector = this.embeddingModel
      ? await this.embeddingModel(input.text)
      : { dimensions: 0, values: [] };

    return {
      id: `${input.userId}:${input.targetType}:${input.targetId}`,
      userId: input.userId,
      targetId: input.targetId,
      targetType: input.targetType,
      modelVersion: input.modelVersion,
      dimensions: vector.dimensions,
      vector: vector.values,
      createdAt: new Date(),
    };
  }

  async batchGenerate(inputs: readonly EmbeddingInput[]): Promise<readonly EmbeddingRecord[]> {
    return Promise.all(inputs.map((input) => this.generate(input)));
  }
}

export const embeddingService = new EmbeddingService();
