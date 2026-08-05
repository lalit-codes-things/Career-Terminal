/**
 * PgVectorStore
 *
 * Implements the VectorStore interface backed by the three pgvector tables:
 *   - candidate_profile_embeddings   (entityType = 'resume' | 'recruiter_profile' | 'candidate')
 *   - opportunity_embeddings          (entityType = 'opportunity')
 *   - application_embeddings          (entityType = 'communication' | 'observation')
 *
 * Uses raw Prisma $queryRaw for similarity queries because Prisma's generated
 * client cannot express the pgvector <=> operator in standard query syntax.
 *
 * store()  — upserts into the appropriate table based on entityType
 * search() — cosine similarity search via pgvector <=> operator
 */

import { prisma } from '../../../config/database';
import type { Embedding } from '../../../domain/recruiter-intelligence/semantic-representation/contracts';
import type { VectorQuery, VectorSearchResult, VectorStore } from '../../../domain/recruiter-intelligence/vector-search/contracts';

const DEFAULT_EMBEDDING_MODEL_ID = 'openrouter:text-embedding-v1';
const DEFAULT_CELL_ID = 'default';

type EmbeddingRow = {
  id: string;
  entity_id: string;
  entity_type: string;
  score: number;
  metadata: Record<string, unknown>;
};

export class PgVectorStore implements VectorStore {
  constructor(
    private readonly modelId: string = DEFAULT_EMBEDDING_MODEL_ID,
    private readonly cellId: string = DEFAULT_CELL_ID,
  ) {}

  // ── Write ────────────────────────────────────────────────────────────────

  async store(embeddings: Embedding[]): Promise<void> {
    for (const emb of embeddings) {
      const vectorLiteral = `[${emb.vector.join(',')}]`;
      const { entityId, entityType, tenantId } = emb.metadata;

      if (entityType === 'opportunity') {
        await prisma.$executeRaw`
          INSERT INTO opportunity_embeddings (id, user_id, cell_id, model_id, embedding, source_type, source_id, metadata, created_at, updated_at)
          VALUES (
            gen_random_uuid(),
            ${tenantId}::uuid,
            ${this.cellId},
            ${this.modelId},
            ${vectorLiteral}::vector,
            'OPPORTUNITY',
            ${entityId}::uuid,
            ${JSON.stringify({ entityType, text: emb.text })}::jsonb,
            now(),
            now()
          )
          ON CONFLICT ON CONSTRAINT uq_opportunity_embeddings_user_model_source
          DO UPDATE SET
            embedding   = ${vectorLiteral}::vector,
            metadata    = ${JSON.stringify({ entityType, text: emb.text })}::jsonb,
            updated_at  = now()
        `;
      } else if (entityType === 'communication' || entityType === 'observation') {
        await prisma.$executeRaw`
          INSERT INTO application_embeddings (id, user_id, cell_id, model_id, embedding, source_type, source_id, metadata, created_at, updated_at)
          VALUES (
            gen_random_uuid(),
            ${tenantId}::uuid,
            ${this.cellId},
            ${this.modelId},
            ${vectorLiteral}::vector,
            'APPLICATION',
            ${entityId}::uuid,
            ${JSON.stringify({ entityType, text: emb.text })}::jsonb,
            now(),
            now()
          )
          ON CONFLICT ON CONSTRAINT uq_application_embeddings_user_model_source
          DO UPDATE SET
            embedding   = ${vectorLiteral}::vector,
            metadata    = ${JSON.stringify({ entityType, text: emb.text })}::jsonb,
            updated_at  = now()
        `;
      } else {
        // candidate_profile_embeddings handles: recruiter_profile, resume, candidate, skill, etc.
        await prisma.$executeRaw`
          INSERT INTO candidate_profile_embeddings (id, user_id, cell_id, model_id, embedding, source_type, source_id, metadata, created_at, updated_at)
          VALUES (
            gen_random_uuid(),
            ${tenantId}::uuid,
            ${this.cellId},
            ${this.modelId},
            ${vectorLiteral}::vector,
            'PROFILE',
            ${entityId}::uuid,
            ${JSON.stringify({ entityType, text: emb.text })}::jsonb,
            now(),
            now()
          )
          ON CONFLICT ON CONSTRAINT uq_candidate_embeddings_user_model_source
          DO UPDATE SET
            embedding   = ${vectorLiteral}::vector,
            metadata    = ${JSON.stringify({ entityType, text: emb.text })}::jsonb,
            updated_at  = now()
        `;
      }
    }
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  async search(query: VectorQuery): Promise<VectorSearchResult[]> {
    const vectorLiteral = `[${query.vector.join(',')}]`;
    const topK = query.topK ?? 10;
    const minSim = query.minSimilarity ?? 0.0;

    // Search all three tables and merge results
    const [candidateRows, opportunityRows, applicationRows] = await Promise.all([
      this.searchTable('candidate_profile_embeddings', vectorLiteral, topK, minSim),
      this.searchTable('opportunity_embeddings', vectorLiteral, topK, minSim),
      this.searchTable('application_embeddings', vectorLiteral, topK, minSim),
    ]);

    const allRows = [...candidateRows, ...opportunityRows, ...applicationRows];

    // Apply metadata filters
    const filtered = query.metadataFilters
      ? allRows.filter((row) => {
          for (const [k, v] of Object.entries(query.metadataFilters!)) {
            const rowVal = row.metadata[k];
            if (Array.isArray(v)) {
              if (!v.map(String).includes(String(rowVal))) return false;
            } else if (rowVal !== v) {
              return false;
            }
          }
          return true;
        })
      : allRows;

    return filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((row) => ({
        entityId: row.entity_id,
        entityType: (row.entity_type ?? 'recruiter_profile') as VectorSearchResult['entityType'],
        score: row.score,
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        text: String((row.metadata)['text'] ?? ''),
        metadata: row.metadata,
      }));
  }

  async deleteByEntityId(entityId: string): Promise<void> {
    await Promise.all([
      prisma.$executeRaw`DELETE FROM candidate_profile_embeddings WHERE source_id = ${entityId}::uuid`,
      prisma.$executeRaw`DELETE FROM opportunity_embeddings WHERE source_id = ${entityId}::uuid`,
      prisma.$executeRaw`DELETE FROM application_embeddings WHERE source_id = ${entityId}::uuid`,
    ]);
  }

  async deleteByTenantId(tenantId: string): Promise<void> {
    await Promise.all([
      prisma.$executeRaw`DELETE FROM candidate_profile_embeddings WHERE user_id = ${tenantId}::uuid`,
      prisma.$executeRaw`DELETE FROM opportunity_embeddings WHERE user_id = ${tenantId}::uuid`,
      prisma.$executeRaw`DELETE FROM application_embeddings WHERE user_id = ${tenantId}::uuid`,
    ]);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async searchTable(
    table: 'candidate_profile_embeddings' | 'opportunity_embeddings' | 'application_embeddings',
    vectorLiteral: string,
    topK: number,
    minSim: number,
  ): Promise<EmbeddingRow[]> {
    try {
      // cosine distance: 1 - (embedding <=> query) = cosine similarity
      if (table === 'candidate_profile_embeddings') {
        return await prisma.$queryRaw<EmbeddingRow[]>`
          SELECT
            id,
            source_id::text AS entity_id,
            source_type AS entity_type,
            (1 - (embedding <=> ${vectorLiteral}::vector))::float AS score,
            metadata
          FROM candidate_profile_embeddings
          WHERE embedding IS NOT NULL
            AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${minSim}
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${topK}
        `;
      } else if (table === 'opportunity_embeddings') {
        return await prisma.$queryRaw<EmbeddingRow[]>`
          SELECT
            id,
            source_id::text AS entity_id,
            source_type AS entity_type,
            (1 - (embedding <=> ${vectorLiteral}::vector))::float AS score,
            metadata
          FROM opportunity_embeddings
          WHERE embedding IS NOT NULL
            AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${minSim}
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${topK}
        `;
      } else {
        return await prisma.$queryRaw<EmbeddingRow[]>`
          SELECT
            id,
            source_id::text AS entity_id,
            source_type AS entity_type,
            (1 - (embedding <=> ${vectorLiteral}::vector))::float AS score,
            metadata
          FROM application_embeddings
          WHERE embedding IS NOT NULL
            AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${minSim}
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${topK}
        `;
      }
    } catch {
      // Table may be empty or vector extension not yet available — return empty
      return [];
    }
  }
}

export const pgVectorStore = new PgVectorStore();
