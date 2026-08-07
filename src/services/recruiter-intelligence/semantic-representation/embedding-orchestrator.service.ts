import { randomUUID } from 'crypto';
import type {
  BatchEmbeddingResult,
  Embedding,
  EmbeddingProvider,
  EntityType,
} from '../../../domain/recruiter-intelligence/semantic-representation/contracts';
import type { VectorStore } from '../../../domain/recruiter-intelligence/vector-search/contracts';

export interface EmbeddingRequest {
  tenantId: string;
  entityId: string;
  entityType: EntityType;
  text: string;
  expiresAt?: Date;
}

/**
 * EmbeddingOrchestratorService —  implementation.
 *
 * Orchestrates the lifecycle of embeddings: batching, generation, storage,
 * invalidation, and refresh. Interacts with provider abstraction and vector store.
 */
export class EmbeddingOrchestratorService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly vectorStore: VectorStore,
  ) {}

  /**
   * Generates and stores a single embedding.
   */
  async embedAndStore(request: EmbeddingRequest): Promise<Embedding> {
    const vector = await this.provider.embedContext(request.text);
    const embedding: Embedding = {
      embeddingId: randomUUID(),
      vector,
      dimensions: this.provider.dimensions,
      text: request.text,
      metadata: {
        entityType: request.entityType,
        entityId: request.entityId,
        tenantId: request.tenantId,
        sourceTextLength: request.text.length,
        modelVersion: this.provider.modelName,
        createdAt: new Date(),
        expiresAt: request.expiresAt,
      },
    };

    await this.vectorStore.store([embedding]);
    return embedding;
  }

  /**
   * Generates and stores embeddings in batch for high throughput.
   */
  async embedBatch(requests: EmbeddingRequest[]): Promise<BatchEmbeddingResult> {
    const texts = requests.map((r) => r.text);
    const result: BatchEmbeddingResult = {
      successful: 0,
      failed: 0,
      embeddings: [],
      errors: [],
    };

    try {
      const vectors = await this.provider.embedBatch(texts);
      const embeddingsToStore: Embedding[] = [];

      for (let i = 0; i < requests.length; i++) {
        const req = requests[i]!;
        const vector = vectors[i]!;
        if (vector) {
          const embedding: Embedding = {
            embeddingId: randomUUID(),
            vector,
            dimensions: this.provider.dimensions,
            text: req.text,
            metadata: {
              entityType: req.entityType,
              entityId: req.entityId,
              tenantId: req.tenantId,
              sourceTextLength: req.text.length,
              modelVersion: this.provider.modelName,
              createdAt: new Date(),
              expiresAt: req.expiresAt,
            },
          };
          embeddingsToStore.push(embedding);
          result.successful++;
          result.embeddings.push(embedding);
        } else {
          result.failed++;
          result.errors.push({ index: i, reason: 'Provider returned null vector' });
        }
      }

      if (embeddingsToStore.length > 0) {
        await this.vectorStore.store(embeddingsToStore);
      }
    } catch (err: any) {
      result.failed = requests.length;
      result.errors.push({ index: -1, reason: err.message ?? 'Batch failure' });
    }

    return result;
  }

  /**
   * Invalidates embeddings by entity ID (e.g. when underlying facts change).
   */
  async invalidateEntity(entityId: string): Promise<void> {
    await this.vectorStore.deleteByEntityId(entityId);
  }

  /**
   * Refreshes an entity's embedding by deleting the old one and creating a new one.
   */
  async refreshEntity(request: EmbeddingRequest): Promise<Embedding> {
    await this.invalidateEntity(request.entityId);
    return this.embedAndStore(request);
  }
}
