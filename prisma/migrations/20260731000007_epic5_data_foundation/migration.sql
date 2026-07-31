-- ============================================================
-- Career Terminal — Epic 5 Data Foundation
-- ============================================================
--
-- Establishes:
--   - official source + dataset + dataset version registry
--   - canonical company extensions (identifiers, domains, source records,
--     relationships)
--   - canonical opportunity extensions (company links, source records)
--   - shared provenance, observation, and source credibility contracts
--   - backfills for existing companies/opportunities
--   - RLS-compatible policies for shared intelligence tables
--
-- Design notes:
--   - PostgreSQL remains the sole durable authority for Epic 5 business state.
--   - Redis remains ephemeral and is not used as a source of record.
--   - Historical records are append-only by default; corrections are explicit.
-- ============================================================

-- ── 1. Enums ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DatasetClassification') THEN
    CREATE TYPE "DatasetClassification" AS ENUM (
      'REFERENCE_DATA',
      'HISTORICAL_DATA',
      'RUNTIME_INGESTION',
      'API_ONLY_SOURCE',
      'DERIVED_DATA',
      'USER_OUTCOME_DATA'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SourceAccessMethod') THEN
    CREATE TYPE "SourceAccessMethod" AS ENUM (
      'DOWNLOAD',
      'API',
      'PUBLIC_WEB',
      'MANUAL',
      'LICENSED_FEED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DatasetVersionStatus') THEN
    CREATE TYPE "DatasetVersionStatus" AS ENUM (
      'STAGED',
      'VALIDATED',
      'IMPORTING',
      'IMPORTED',
      'FAILED',
      'VERIFIED',
      'SUPERSEDED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SourceRecordStatus') THEN
    CREATE TYPE "SourceRecordStatus" AS ENUM (
      'ACTIVE',
      'SUPERSEDED',
      'RETRACTED',
      'INVALIDATED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ObservationKind') THEN
    CREATE TYPE "ObservationKind" AS ENUM (
      'OBSERVED_FACT',
      'INFERENCE',
      'SIGNAL'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConfidenceLevel') THEN
    CREATE TYPE "ConfidenceLevel" AS ENUM (
      'HIGH',
      'MEDIUM',
      'LOW',
      'UNKNOWN'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CompanyRelationshipType') THEN
    CREATE TYPE "CompanyRelationshipType" AS ENUM (
      'BRAND',
      'LEGAL_ENTITY',
      'PARENT',
      'SUBSIDIARY',
      'FORMER_NAME',
      'ACQUIRED_ENTITY'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OpportunityCompanyLinkType') THEN
    CREATE TYPE "OpportunityCompanyLinkType" AS ENUM (
      'HIRING_COMPANY',
      'EMPLOYER_OF_RECORD',
      'STAFFING_FIRM',
      'RECRUITING_AGENCY'
    );
  END IF;
END
$$;

-- ── 2. Extend existing canonical entities ──────────────────────────────────

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "normalized_name" TEXT,
  ADD COLUMN IF NOT EXISTS "legal_name" TEXT,
  ADD COLUMN IF NOT EXISTS "country_code" TEXT,
  ADD COLUMN IF NOT EXISTS "jurisdiction_code" TEXT,
  ADD COLUMN IF NOT EXISTS "company_status" TEXT,
  ADD COLUMN IF NOT EXISTS "company_type" TEXT;

UPDATE "companies"
SET "normalized_name" = btrim(regexp_replace(lower("name"), '[^a-z0-9]+', ' ', 'g'))
WHERE "normalized_name" IS NULL;

CREATE INDEX IF NOT EXISTS "companies_normalized_name_idx" ON "companies" ("normalized_name");
CREATE INDEX IF NOT EXISTS "companies_country_jurisdiction_idx"
  ON "companies" ("country_code", "jurisdiction_code");

ALTER TABLE "opportunities"
  ADD COLUMN IF NOT EXISTS "canonical_status" TEXT NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS "country_code" TEXT,
  ADD COLUMN IF NOT EXISTS "language_code" TEXT;

CREATE INDEX IF NOT EXISTS "opportunities_status_country_idx"
  ON "opportunities" ("canonical_status", "country_code");

-- ── 3. Shared source + dataset registry ────────────────────────────────────

CREATE TABLE IF NOT EXISTS "intelligence_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "country_code" TEXT,
  "region" TEXT,
  "jurisdiction_code" TEXT,
  "data_purpose" TEXT NOT NULL,
  "official_url" TEXT NOT NULL,
  "access_method" "SourceAccessMethod" NOT NULL,
  "requires_download" BOOLEAN NOT NULL DEFAULT false,
  "refresh_cadence" TEXT,
  "historical_depth" TEXT,
  "license_reference" TEXT,
  "terms_url" TEXT,
  "redistribution_restrictions" TEXT,
  "entity_identifiers" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "data_quality_notes" TEXT,
  "known_limitations" TEXT,
  "default_language_code" TEXT,
  "is_official" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "intelligence_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_sources_slug_key"
  ON "intelligence_sources" ("slug");
CREATE INDEX IF NOT EXISTS "intelligence_sources_country_jurisdiction_idx"
  ON "intelligence_sources" ("country_code", "jurisdiction_code");
CREATE INDEX IF NOT EXISTS "intelligence_sources_access_download_idx"
  ON "intelligence_sources" ("access_method", "requires_download");

CREATE TABLE IF NOT EXISTS "intelligence_datasets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "dataset_name" TEXT NOT NULL,
  "dataset_type" "DatasetClassification" NOT NULL,
  "entity_type" TEXT,
  "purpose" TEXT NOT NULL,
  "storage_location" TEXT,
  "import_location" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REGISTERED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "intelligence_datasets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intelligence_datasets_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_datasets_slug_key"
  ON "intelligence_datasets" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "unique_dataset_per_source"
  ON "intelligence_datasets" ("source_id", "dataset_name");
CREATE INDEX IF NOT EXISTS "intelligence_datasets_type_status_idx"
  ON "intelligence_datasets" ("dataset_type", "status");

CREATE TABLE IF NOT EXISTS "dataset_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dataset_id" UUID NOT NULL,
  "source_version" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "retrieved_at" TIMESTAMPTZ NOT NULL,
  "published_at" TIMESTAMPTZ,
  "checksum" TEXT NOT NULL,
  "checksum_algorithm" TEXT NOT NULL DEFAULT 'sha256',
  "license_reference" TEXT,
  "import_status" "DatasetVersionStatus" NOT NULL,
  "record_count" INTEGER,
  "imported_at" TIMESTAMPTZ,
  "activated_at" TIMESTAMPTZ,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "stage_path" TEXT,
  "raw_reference" TEXT,
  "import_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "dataset_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dataset_versions_dataset_id_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "intelligence_datasets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_dataset_version_checksum"
  ON "dataset_versions" ("dataset_id", "source_version", "checksum");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dataset_versions_active_per_dataset"
  ON "dataset_versions" ("dataset_id")
  WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "dataset_versions_dataset_active_idx"
  ON "dataset_versions" ("dataset_id", "is_active");
CREATE INDEX IF NOT EXISTS "dataset_versions_status_retrieved_idx"
  ON "dataset_versions" ("import_status", "retrieved_at");
CREATE INDEX IF NOT EXISTS "dataset_versions_published_at_idx"
  ON "dataset_versions" ("published_at");

CREATE TABLE IF NOT EXISTS "dataset_import_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dataset_version_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  "status" TEXT NOT NULL,
  "records_read" INTEGER NOT NULL DEFAULT 0,
  "records_accepted" INTEGER NOT NULL DEFAULT 0,
  "records_rejected" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "validation_failure_count" INTEGER NOT NULL DEFAULT 0,
  "execution_time_ms" INTEGER,
  "error_summary" TEXT,
  "stats" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "dataset_import_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dataset_import_runs_dataset_version_id_fkey"
    FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "dataset_import_runs_dataset_version_idx"
  ON "dataset_import_runs" ("dataset_version_id");
CREATE INDEX IF NOT EXISTS "dataset_import_runs_status_started_idx"
  ON "dataset_import_runs" ("status", "started_at");

-- ── 4. Company foundation ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "company_identifiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "identifier_type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "normalized_value" TEXT NOT NULL,
  "country_code" TEXT,
  "jurisdiction_code" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "company_identifiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_identifiers_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "company_identifiers_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_company_identifier_per_source"
  ON "company_identifiers" ("source_id", "identifier_type", "normalized_value");
CREATE INDEX IF NOT EXISTS "company_identifiers_company_id_idx"
  ON "company_identifiers" ("company_id");
CREATE INDEX IF NOT EXISTS "company_identifiers_type_value_idx"
  ON "company_identifiers" ("identifier_type", "normalized_value");
CREATE INDEX IF NOT EXISTS "company_identifiers_country_jurisdiction_idx"
  ON "company_identifiers" ("country_code", "jurisdiction_code");

CREATE TABLE IF NOT EXISTS "company_domains" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "source_id" UUID,
  "domain" TEXT NOT NULL,
  "normalized_domain" TEXT NOT NULL,
  "domain_type" TEXT NOT NULL DEFAULT 'PRIMARY',
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "company_domains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_domains_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "company_domains_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_domains_normalized_domain_key"
  ON "company_domains" ("normalized_domain");
CREATE INDEX IF NOT EXISTS "company_domains_company_id_idx"
  ON "company_domains" ("company_id");
CREATE INDEX IF NOT EXISTS "company_domains_source_id_idx"
  ON "company_domains" ("source_id");
CREATE INDEX IF NOT EXISTS "company_domains_is_primary_idx"
  ON "company_domains" ("is_primary");

INSERT INTO "company_domains" (
  "id",
  "company_id",
  "domain",
  "normalized_domain",
  "domain_type",
  "is_primary",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  c."id",
  c."domain",
  lower(c."domain"),
  'PRIMARY',
  true,
  c."created_at",
  c."updated_at"
FROM "companies" c
WHERE c."domain" IS NOT NULL
ON CONFLICT ("normalized_domain") DO NOTHING;

CREATE TABLE IF NOT EXISTS "company_source_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "dataset_version_id" UUID,
  "external_record_id" TEXT NOT NULL,
  "source_url" TEXT,
  "source_version" TEXT,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "published_at" TIMESTAMPTZ,
  "retrieved_at" TIMESTAMPTZ,
  "content_hash" TEXT,
  "raw_reference" TEXT,
  "status" "SourceRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "company_source_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_source_records_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "company_source_records_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "company_source_records_dataset_version_id_fkey"
    FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_company_source_record"
  ON "company_source_records" ("source_id", "external_record_id");
CREATE INDEX IF NOT EXISTS "company_source_records_company_observed_idx"
  ON "company_source_records" ("company_id", "observed_at");
CREATE INDEX IF NOT EXISTS "company_source_records_source_status_idx"
  ON "company_source_records" ("source_id", "status");
CREATE INDEX IF NOT EXISTS "company_source_records_dataset_version_idx"
  ON "company_source_records" ("dataset_version_id");

-- ── 5. Opportunity foundation ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "opportunity_source_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "dataset_version_id" UUID,
  "external_record_id" TEXT NOT NULL,
  "source_url" TEXT,
  "source_version" TEXT,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "published_at" TIMESTAMPTZ,
  "retrieved_at" TIMESTAMPTZ,
  "content_hash" TEXT,
  "raw_reference" TEXT,
  "status" "SourceRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "opportunity_source_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunity_source_records_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "opportunity_source_records_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "opportunity_source_records_dataset_version_id_fkey"
    FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_opportunity_source_record"
  ON "opportunity_source_records" ("source_id", "external_record_id");
CREATE INDEX IF NOT EXISTS "opportunity_source_records_opportunity_observed_idx"
  ON "opportunity_source_records" ("opportunity_id", "observed_at");
CREATE INDEX IF NOT EXISTS "opportunity_source_records_source_status_idx"
  ON "opportunity_source_records" ("source_id", "status");
CREATE INDEX IF NOT EXISTS "opportunity_source_records_dataset_version_idx"
  ON "opportunity_source_records" ("dataset_version_id");

CREATE TABLE IF NOT EXISTS "intelligence_provenance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" UUID NOT NULL,
  "dataset_version_id" UUID,
  "source_record_type" TEXT,
  "source_record_id" TEXT,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "published_at" TIMESTAMPTZ,
  "retrieved_at" TIMESTAMPTZ,
  "processing_version" TEXT,
  "confidence_level" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
  "confidence_basis" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "intelligence_provenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intelligence_provenance_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "intelligence_provenance_dataset_version_id_fkey"
    FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "intelligence_provenance_source_observed_idx"
  ON "intelligence_provenance" ("source_id", "observed_at");
CREATE INDEX IF NOT EXISTS "intelligence_provenance_dataset_version_idx"
  ON "intelligence_provenance" ("dataset_version_id");
CREATE INDEX IF NOT EXISTS "intelligence_provenance_record_identity_idx"
  ON "intelligence_provenance" ("source_record_type", "source_record_id");

CREATE TABLE IF NOT EXISTS "opportunity_company_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "link_type" "OpportunityCompanyLinkType" NOT NULL DEFAULT 'HIRING_COMPANY',
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "confidence_level" "ConfidenceLevel" NOT NULL DEFAULT 'HIGH',
  "confidence_basis" TEXT,
  "provenance_id" UUID,
  "valid_from" TIMESTAMPTZ,
  "valid_to" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "opportunity_company_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunity_company_links_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "opportunity_company_links_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "opportunity_company_links_provenance_id_fkey"
    FOREIGN KEY ("provenance_id") REFERENCES "intelligence_provenance"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_opportunity_company_link"
  ON "opportunity_company_links" ("opportunity_id", "company_id", "link_type");
CREATE INDEX IF NOT EXISTS "opportunity_company_links_company_id_idx"
  ON "opportunity_company_links" ("company_id");
CREATE INDEX IF NOT EXISTS "opportunity_company_links_opportunity_primary_idx"
  ON "opportunity_company_links" ("opportunity_id", "is_primary");
CREATE INDEX IF NOT EXISTS "opportunity_company_links_provenance_idx"
  ON "opportunity_company_links" ("provenance_id");

INSERT INTO "opportunity_company_links" (
  "id",
  "opportunity_id",
  "company_id",
  "link_type",
  "is_primary",
  "confidence_level",
  "confidence_basis",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  o."id",
  o."company_id",
  'HIRING_COMPANY',
  true,
  'HIGH',
  'Backfilled from canonical opportunities.company_id',
  o."created_at",
  o."updated_at"
FROM "opportunities" o
ON CONFLICT ("opportunity_id", "company_id", "link_type") DO NOTHING;

-- ── 6. Relationships, observations, and credibility ───────────────────────

CREATE TABLE IF NOT EXISTS "company_relationships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "from_company_id" UUID NOT NULL,
  "to_company_id" UUID NOT NULL,
  "relationship_type" "CompanyRelationshipType" NOT NULL,
  "source_record_id" UUID,
  "provenance_id" UUID,
  "valid_from" TIMESTAMPTZ,
  "valid_to" TIMESTAMPTZ,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "company_relationships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_relationships_from_company_id_fkey"
    FOREIGN KEY ("from_company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "company_relationships_to_company_id_fkey"
    FOREIGN KEY ("to_company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "company_relationships_source_record_id_fkey"
    FOREIGN KEY ("source_record_id") REFERENCES "company_source_records"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "company_relationships_provenance_id_fkey"
    FOREIGN KEY ("provenance_id") REFERENCES "intelligence_provenance"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "company_relationships_from_type_current_idx"
  ON "company_relationships" ("from_company_id", "relationship_type", "is_current");
CREATE INDEX IF NOT EXISTS "company_relationships_to_type_current_idx"
  ON "company_relationships" ("to_company_id", "relationship_type", "is_current");
CREATE INDEX IF NOT EXISTS "company_relationships_source_record_idx"
  ON "company_relationships" ("source_record_id");
CREATE INDEX IF NOT EXISTS "company_relationships_provenance_idx"
  ON "company_relationships" ("provenance_id");

CREATE TABLE IF NOT EXISTS "entity_observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "company_id" UUID,
  "opportunity_id" UUID,
  "source_id" UUID NOT NULL,
  "provenance_id" UUID,
  "source_record_type" TEXT,
  "source_record_id" TEXT,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "effective_at" TIMESTAMPTZ,
  "observation_type" TEXT NOT NULL,
  "observation_kind" "ObservationKind" NOT NULL DEFAULT 'OBSERVED_FACT',
  "observation_value" JSONB,
  "reference_url" TEXT,
  "confidence_level" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
  "confidence_basis" TEXT,
  "supersedes_observation_id" UUID,
  "corrects_observation_id" UUID,
  "retracted_at" TIMESTAMPTZ,
  "invalidated_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "entity_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entity_observations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "entity_observations_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "entity_observations_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "entity_observations_provenance_id_fkey"
    FOREIGN KEY ("provenance_id") REFERENCES "intelligence_provenance"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "entity_observations_entity_type_check"
    CHECK ("entity_type" IN ('COMPANY', 'OPPORTUNITY')),
  CONSTRAINT "entity_observations_entity_identity_check"
    CHECK (
      (
        "entity_type" = 'COMPANY'
        AND "company_id" IS NOT NULL
        AND "opportunity_id" IS NULL
        AND "entity_id" = ("company_id")::text
      )
      OR
      (
        "entity_type" = 'OPPORTUNITY'
        AND "opportunity_id" IS NOT NULL
        AND "company_id" IS NULL
        AND "entity_id" = ("opportunity_id")::text
      )
    )
);

CREATE INDEX IF NOT EXISTS "entity_observations_entity_time_idx"
  ON "entity_observations" ("entity_type", "entity_id", "observed_at");
CREATE INDEX IF NOT EXISTS "entity_observations_company_time_idx"
  ON "entity_observations" ("company_id", "observed_at");
CREATE INDEX IF NOT EXISTS "entity_observations_opportunity_time_idx"
  ON "entity_observations" ("opportunity_id", "observed_at");
CREATE INDEX IF NOT EXISTS "entity_observations_source_time_idx"
  ON "entity_observations" ("source_id", "observed_at");
CREATE INDEX IF NOT EXISTS "entity_observations_provenance_idx"
  ON "entity_observations" ("provenance_id");
CREATE INDEX IF NOT EXISTS "entity_observations_supersedes_idx"
  ON "entity_observations" ("supersedes_observation_id");
CREATE INDEX IF NOT EXISTS "entity_observations_corrects_idx"
  ON "entity_observations" ("corrects_observation_id");

CREATE TABLE IF NOT EXISTS "source_credibility_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" UUID NOT NULL,
  "country_code" TEXT,
  "data_category" TEXT NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "historical_reliability" TEXT,
  "freshness_expectation" TEXT,
  "confidence_level" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "source_credibility_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_credibility_profiles_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_source_credibility_profile"
  ON "source_credibility_profiles" ("source_id", "country_code", "data_category", "evidence_type");
CREATE INDEX IF NOT EXISTS "source_credibility_profiles_country_category_idx"
  ON "source_credibility_profiles" ("country_code", "data_category");

-- ── 7. Shared-intelligence RLS policies ────────────────────────────────────

ALTER TABLE "intelligence_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intelligence_datasets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dataset_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dataset_import_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_identifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_source_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_relationships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_company_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_source_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intelligence_provenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entity_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_credibility_profiles" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_sources_select_policy ON "intelligence_sources";
CREATE POLICY intelligence_sources_select_policy ON "intelligence_sources"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS intelligence_sources_write_policy ON "intelligence_sources";
CREATE POLICY intelligence_sources_write_policy ON "intelligence_sources"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS intelligence_datasets_select_policy ON "intelligence_datasets";
CREATE POLICY intelligence_datasets_select_policy ON "intelligence_datasets"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS intelligence_datasets_write_policy ON "intelligence_datasets";
CREATE POLICY intelligence_datasets_write_policy ON "intelligence_datasets"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS dataset_versions_select_policy ON "dataset_versions";
CREATE POLICY dataset_versions_select_policy ON "dataset_versions"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS dataset_versions_write_policy ON "dataset_versions";
CREATE POLICY dataset_versions_write_policy ON "dataset_versions"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS dataset_import_runs_select_policy ON "dataset_import_runs";
CREATE POLICY dataset_import_runs_select_policy ON "dataset_import_runs"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS dataset_import_runs_write_policy ON "dataset_import_runs";
CREATE POLICY dataset_import_runs_write_policy ON "dataset_import_runs"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_identifiers_select_policy ON "company_identifiers";
CREATE POLICY company_identifiers_select_policy ON "company_identifiers"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_identifiers_write_policy ON "company_identifiers";
CREATE POLICY company_identifiers_write_policy ON "company_identifiers"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_domains_select_policy ON "company_domains";
CREATE POLICY company_domains_select_policy ON "company_domains"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_domains_write_policy ON "company_domains";
CREATE POLICY company_domains_write_policy ON "company_domains"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_source_records_select_policy ON "company_source_records";
CREATE POLICY company_source_records_select_policy ON "company_source_records"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_source_records_write_policy ON "company_source_records";
CREATE POLICY company_source_records_write_policy ON "company_source_records"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_relationships_select_policy ON "company_relationships";
CREATE POLICY company_relationships_select_policy ON "company_relationships"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS company_relationships_write_policy ON "company_relationships";
CREATE POLICY company_relationships_write_policy ON "company_relationships"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS opportunity_company_links_select_policy ON "opportunity_company_links";
CREATE POLICY opportunity_company_links_select_policy ON "opportunity_company_links"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS opportunity_company_links_write_policy ON "opportunity_company_links";
CREATE POLICY opportunity_company_links_write_policy ON "opportunity_company_links"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS opportunity_source_records_select_policy ON "opportunity_source_records";
CREATE POLICY opportunity_source_records_select_policy ON "opportunity_source_records"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS opportunity_source_records_write_policy ON "opportunity_source_records";
CREATE POLICY opportunity_source_records_write_policy ON "opportunity_source_records"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS intelligence_provenance_select_policy ON "intelligence_provenance";
CREATE POLICY intelligence_provenance_select_policy ON "intelligence_provenance"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS intelligence_provenance_write_policy ON "intelligence_provenance";
CREATE POLICY intelligence_provenance_write_policy ON "intelligence_provenance"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS entity_observations_select_policy ON "entity_observations";
CREATE POLICY entity_observations_select_policy ON "entity_observations"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS entity_observations_write_policy ON "entity_observations";
CREATE POLICY entity_observations_write_policy ON "entity_observations"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS source_credibility_profiles_select_policy ON "source_credibility_profiles";
CREATE POLICY source_credibility_profiles_select_policy ON "source_credibility_profiles"
  FOR SELECT
  USING (
    pg_has_role(current_user, 'app_runtime', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_readonly', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

DROP POLICY IF EXISTS source_credibility_profiles_write_policy ON "source_credibility_profiles";
CREATE POLICY source_credibility_profiles_write_policy ON "source_credibility_profiles"
  FOR ALL
  USING (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  )
  WITH CHECK (
    pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );
