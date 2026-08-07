import type { EmbeddingDimensions, EmbeddingProvider } from '../../../../domain/recruiter-intelligence/semantic-representation/contracts';

/**
 * StubEmbeddingAdapter —  implementation.
 *
 * In-memory stub for embedding generation that creates deterministic vectors for tests.
 * Generates pseudo-random but deterministic vectors based on input text length.
 */
export class StubEmbeddingAdapter implements EmbeddingProvider {
  constructor(
    public readonly providerId: string = 'stub-embedding-provider',
    public readonly modelName: string = 'stub-text-embedding-v1',
    public readonly dimensions: EmbeddingDimensions = 384,
    public readonly maxTokens: number = 8192,
  ) {}

  async embedContext(text: string): Promise<number[]> {
    return this.generateDeterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.generateDeterministicVector(t));
  }

  private generateDeterministicVector(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0);
    // Use string length and char codes to create a somewhat distinct vector per string
    const seed = text.length + (text.charCodeAt(0) || 0) + (text.charCodeAt(Math.floor(text.length / 2)) || 0);

    for (let i = 0; i < this.dimensions; i++) {
      // Deterministic pseudo-random generation
      const val = Math.sin(seed + i) * 0.5 + 0.5; // normalized 0-1
      vector[i] = val;
    }

    // Normalize vector (L2 norm)
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => (norm > 0 ? v / norm : 0));
  }
}
