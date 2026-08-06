/**
 * HybridRetrievalService
 *
 * Semantic + keyword retrieval backed by pgvector (CandidateProfileEmbedding,
 * OpportunityEmbedding, ApplicationEmbedding).
 *
 * The VectorStore injected here is PgVectorStore in production; the stub
 * InMemoryVectorStore is still used in unit tests.
 */

import type { EmbeddingProvider } from '../../../domain/recruiter-intelligence/semantic-representation/contracts';
import type {
  HybridQuery,
  HybridSearchResult,
  VectorSearchResult,
  VectorStore,
} from '../../../domain/recruiter-intelligence/vector-search/contracts';
import { pgVectorStore } from '../infrastructure/pgvector.store';
import { StubEmbeddingAdapter } from '../ai/adapters/stub-embedding.adapter';

/**
 * Build a default instance wired to pgvector + stub embeddings.
 * In production replace StubEmbeddingAdapter with a real embedding adapter
 * (e.g. OpenRouter's embedding proxy).
 */
export function createHybridRetrievalService(
  provider?: EmbeddingProvider,
  vectorStore?: VectorStore,
): HybridRetrievalService {
  return new HybridRetrievalService(
    provider ?? new StubEmbeddingAdapter('openrouter-embedding', 'text-embedding-v1', 1536),
    vectorStore ?? pgVectorStore,
  );
}

export class HybridRetrievalService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorStore: VectorStore,
  ) {}

  /**
   * Hybrid search: weighted combination of vector similarity and BM25-style
   * keyword overlap.  Defaults to 70 % vector / 30 % keyword.
   */
  async search(query: HybridQuery): Promise<HybridSearchResult[]> {
    const textWeight = query.weights?.text ?? 0.3;
    const vectorWeight = query.weights?.vector ?? 0.7;
    const topK = query.vectorQuery?.topK ?? 10;

    let vectorResults: VectorSearchResult[] = [];

    if (query.vectorQuery) {
      let queryVector = query.vectorQuery.vector;
      if (!queryVector || queryVector.length === 0) {
        if (query.textQuery) {
          queryVector = await this.provider.embedContext(query.textQuery);
        } else {
          throw new Error('Vector search requires either a vector or a text query');
        }
      }
      vectorResults = await this.vectorStore.search({
        ...query.vectorQuery,
        vector: queryVector,
        tenantId: query.tenantId,
      });
    } else if (query.textQuery) {
      // Text-only query: embed the text and search
      const queryVector = await this.provider.embedContext(query.textQuery);
      vectorResults = await this.vectorStore.search({
        vector: queryVector,
        topK,
        minSimilarity: 0.3,
        tenantId: query.tenantId,
        metadataFilters: undefined,
      });
    }

    // Keyword scoring against retrieved text blobs
    const keywordResults = new Map<string, number>();
    if (query.textQuery && vectorResults.length > 0) {
      const tokens = query.textQuery.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
      for (const res of vectorResults) {
        if (!tokens.length) continue;
        const textLower = res.text.toLowerCase();
        const matchCount = tokens.filter((t) => textLower.includes(t)).length;
        keywordResults.set(res.entityId, matchCount / tokens.length);
      }
    }

    const hybridResults: HybridSearchResult[] = vectorResults.map((vr) => {
      const textScore = keywordResults.get(vr.entityId) ?? 0;
      const hybridScore = vr.score * vectorWeight + textScore * textWeight;
      return { ...vr, vectorScore: vr.score, textScore, hybridScore };
    });

    return hybridResults.sort((a, b) => b.hybridScore - a.hybridScore).slice(0, topK);
  }

  /**
   * Embed and store a piece of text in the appropriate pgvector table.
   * entityType determines the destination table (see PgVectorStore.store).
   */
  async embed(
    text: string,
    entityId: string,
    entityType: import('../../../domain/recruiter-intelligence/semantic-representation/contracts').EntityType,
    tenantId: string,
  ): Promise<void> {
    const vector = await this.provider.embedContext(text);
    await this.vectorStore.store([
      {
        embeddingId: `${entityId}-${Date.now()}`,
        vector,
        dimensions: vector.length as 1536,
        text,
        metadata: {
          entityType,
          entityId,
          tenantId,
          sourceTextLength: text.length,
          modelVersion: this.provider.modelName,
          createdAt: new Date(),
        },
      },
    ]);
  }
}

/** Singleton wired to pgvector — import this everywhere */
export const hybridRetrievalService = createHybridRetrievalService();
