import type { EmbeddingProvider } from '../../../domain/recruiter-intelligence/semantic-representation/contracts';
import type {
  HybridQuery,
  HybridSearchResult,
  VectorStore,
} from '../../../domain/recruiter-intelligence/vector-search/contracts';

/**
 * HybridRetrievalService — Prompt 22 implementation.
 *
 * Implements semantic retrieval combining vector search and keyword matching.
 * Provides metadata filtering, confidence filtering, and temporal filtering.
 */
export class HybridRetrievalService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorStore: VectorStore,
  ) {}

  /**
   * Performs hybrid search using Reciprocal Rank Fusion (RRF) for semantic + text results,
   * though in this simplified implementation it uses a weighted linear combination.
   */
  async search(query: HybridQuery): Promise<HybridSearchResult[]> {
    const textWeight = query.weights?.text ?? 0.3;
    const vectorWeight = query.weights?.vector ?? 0.7;
    const topK = query.vectorQuery?.topK ?? 10;

    let vectorResults: Array<{ entityId: string; score: number; text: string; metadata: any; entityType: string }> = [];

    // 1. Vector Search
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
      });
    }

    // 2. Keyword Search Simulation (for stubbing/demonstration)
    // In a real implementation this would query ElasticSearch or Postgres FTS.
    const keywordResults = new Map<string, number>();
    if (query.textQuery && vectorResults.length > 0) {
      const tokens = query.textQuery.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
      for (const res of vectorResults) {
        let matchCount = 0;
        const textLower = res.text.toLowerCase();
        for (const token of tokens) {
          if (textLower.includes(token)) matchCount++;
        }
        const keywordScore = tokens.length > 0 ? matchCount / tokens.length : 0;
        keywordResults.set(res.entityId, keywordScore);
      }
    }

    // 3. Score fusion
    const hybridResults: HybridSearchResult[] = vectorResults.map((vr) => {
      const textScore = keywordResults.get(vr.entityId) ?? 0;
      const hybridScore = (vr.score * vectorWeight) + (textScore * textWeight);
      return {
        ...vr,
        vectorScore: vr.score,
        textScore,
        hybridScore,
      };
    });

    // 4. Sort by hybrid score and limit
    return hybridResults
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, topK);
  }
}
