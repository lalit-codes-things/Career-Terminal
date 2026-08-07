import type { Embedding } from '../../../domain/recruiter-intelligence/semantic-representation/contracts';
import type { VectorQuery, VectorSearchResult, VectorStore } from '../../../domain/recruiter-intelligence/vector-search/contracts';

/**
 * InMemoryVectorStore — Prompt 22 implementation backing.
 *
 * In-memory implementation of the VectorStore interface.
 * Supports basic cosine similarity search and metadata filtering for testing.
 */
export class InMemoryVectorStore implements VectorStore {
  private embeddings: Embedding[] = [];

  async store(embeddings: Embedding[]): Promise<void> {
    this.embeddings.push(...embeddings);
  }

  async search(query: VectorQuery): Promise<VectorSearchResult[]> {
    let candidates = this.embeddings;

    // Apply tenant filter first
    if (query.tenantId) {
      candidates = candidates.filter((emb) => emb.metadata.tenantId === query.tenantId);
    }

    // Apply non-tenant metadata filters
    if (query.metadataFilters) {
      candidates = candidates.filter((emb) => {
        for (const [k, v] of Object.entries(query.metadataFilters!)) {
          // Flatten metadata check
          const embVal = (emb.metadata as any)[k];
          if (Array.isArray(v)) {
            if (!v.includes(embVal)) return false;
          } else if (embVal !== v) {
            return false;
          }
        }
        return true;
      });
    }

    // Apply temporal filters
    if (query.temporalFilters) {
      candidates = candidates.filter((emb) => {
        const t = emb.metadata.createdAt.getTime();
        if (query.temporalFilters!.since && t < query.temporalFilters!.since.getTime()) return false;
        if (query.temporalFilters!.until && t > query.temporalFilters!.until.getTime()) return false;
        return true;
      });
    }

    // Calculate similarity
    const results = candidates.map((emb) => ({
      emb,
      score: this.cosineSimilarity(query.vector, emb.vector),
    }));

    // Filter by threshold and sort
    const minSim = query.minSimilarity ?? 0.0;
    return results
      .filter((r) => r.score >= minSim)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.topK)
      .map((r) => ({
        entityId: r.emb.metadata.entityId,
        entityType: r.emb.metadata.entityType,
        score: r.score,
        text: r.emb.text,
        metadata: r.emb.metadata as any,
      }));
  }

  async deleteByEntityId(entityId: string): Promise<void> {
    this.embeddings = this.embeddings.filter((e) => e.metadata.entityId !== entityId);
  }

  async deleteByTenantId(tenantId: string): Promise<void> {
    this.embeddings = this.embeddings.filter((e) => e.metadata.tenantId !== tenantId);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
