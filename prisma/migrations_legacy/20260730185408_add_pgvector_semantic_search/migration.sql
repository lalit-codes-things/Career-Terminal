-- ============================================================
-- Career Terminal — pgvector Semantic Search Support
-- ============================================================
--
-- Adds the pgvector extension and supporting schema for derived
-- vector embeddings. PostgreSQL domain records remain authoritative;
-- vectors are secondary derived data used only for semantic retrieval.

-- ------------------------------------------------------------
-- 1. Enable pgvector extension
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------
-- 2. Embedding version tracking (supports re-embedding)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "embedding_models" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_embedding_models_active" ON "embedding_models" ("id") WHERE "isActive" = true;

-- ------------------------------------------------------------
-- 3. Candidate profile embeddings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "candidate_profile_embeddings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "cellId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL REFERENCES "embedding_models"("id"),
  "embedding" vector(1536) NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'PROFILE',
  "sourceId" UUID NOT NULL,
  "metadata" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "candidate_profile_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_candidate_profile_embeddings_user_model_source"
  ON "candidate_profile_embeddings" ("userId", "modelId", "sourceType", "sourceId");

-- HNSW index for cosine similarity (normalize vectors before insert)
CREATE INDEX IF NOT EXISTS "idx_candidate_profile_embeddings_hnsw"
  ON "candidate_profile_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ------------------------------------------------------------
-- 4. Opportunity embeddings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "opportunity_embeddings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "cellId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL REFERENCES "embedding_models"("id"),
  "embedding" vector(1536) NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'OPPORTUNITY',
  "sourceId" UUID NOT NULL,
  "metadata" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "opportunity_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_opportunity_embeddings_user_model_source"
  ON "opportunity_embeddings" ("userId", "modelId", "sourceType", "sourceId") WHERE "userId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_opportunity_embeddings_model_source"
  ON "opportunity_embeddings" ("modelId", "sourceType", "sourceId") WHERE "userId" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_opportunity_embeddings_hnsw"
  ON "opportunity_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ------------------------------------------------------------
-- 5. Application embeddings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "application_embeddings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "cellId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL REFERENCES "embedding_models"("id"),
  "embedding" vector(1536) NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'APPLICATION',
  "sourceId" UUID NOT NULL,
  "metadata" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "application_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_application_embeddings_user_model_source"
  ON "application_embeddings" ("userId", "modelId", "sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "idx_application_embeddings_hnsw"
  ON "application_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ------------------------------------------------------------
-- 6. Seed the default embedding model
-- ------------------------------------------------------------
INSERT INTO "embedding_models" ("id", "name", "version", "dimensions", "isActive")
VALUES ('text-embedding-3-large', 'OpenAI Text Embedding 3 Large', 'v1', 1536, true)
ON CONFLICT ("id") DO UPDATE SET "updatedAt" = NOW();
