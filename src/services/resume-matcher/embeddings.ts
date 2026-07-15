export interface EmbeddingProvider {
  getEmbedding(text: string): Promise<number[]>;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  public async getEmbedding(text: string): Promise<number[]> {
    // Generate a deterministic but pseudo-random vector based on the string hash
    const hash = this.hashString(text.toLowerCase().trim());
    const vector = new Array(1536).fill(0).map((_, i) => {
      const val = Math.sin(hash + i) * 100;
      return (val - Math.floor(val)) * 2 - 1; // Normalize between -1 and 1
    });

    // Normalize the vector
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / magnitude);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must be of the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i]!;
    const b = vecB[i]!;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// For this mock implementation to produce good enough results for "testing",
// we will add a semanticMatcher that bypasses true vector math for simple exact/fuzzy matches,
// but the interface stays vector-ready.
export class SemanticMatcher {
  constructor(private embeddingProvider: EmbeddingProvider = new MockEmbeddingProvider()) {}

  public async scoreSimilarity(textA: string, textB: string): Promise<number> {
    const cleanA = textA.toLowerCase().trim();
    const cleanB = textB.toLowerCase().trim();

    // Exact match short-circuit for testing/mocking
    if (cleanA === cleanB) return 1.0;
    
    // Substring mock
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return 0.8;

    // True embedding match
    const vecA = await this.embeddingProvider.getEmbedding(textA);
    const vecB = await this.embeddingProvider.getEmbedding(textB);

    return cosineSimilarity(vecA, vecB);
  }
}
