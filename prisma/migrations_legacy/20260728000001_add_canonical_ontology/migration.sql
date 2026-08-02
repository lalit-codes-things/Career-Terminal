-- Epic 4 Prompt 6 — Global Canonical Ontology
--
-- Adds the profession-neutral reference tables that replace all
-- runtime CSV loading in the application layer.
--
-- Backfill: none at migration time.
-- Run `npx ts-node scripts/import-ontology.ts` after applying this
-- migration to populate the tables from the bundled datasets.

BEGIN;

-- ── Occupations ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_occupations" (
  "id"             UUID    NOT NULL DEFAULT gen_random_uuid(),
  "canonical_name" TEXT    NOT NULL,
  "source"         TEXT    NOT NULL,
  "source_id"      TEXT    NOT NULL,
  "source_version" TEXT,
  CONSTRAINT "canonical_occupations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canonical_occupations_source_source_id_key" UNIQUE ("source", "source_id")
);

CREATE INDEX IF NOT EXISTS "canonical_occupations_canonical_name_idx"
  ON "canonical_occupations" ("canonical_name");

CREATE TABLE IF NOT EXISTS "canonical_occupation_aliases" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "occupation_id" UUID NOT NULL,
  "alias"         TEXT NOT NULL,
  CONSTRAINT "canonical_occupation_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canonical_occupation_aliases_occupation_id_fkey"
    FOREIGN KEY ("occupation_id")
    REFERENCES "canonical_occupations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "canonical_occupation_aliases_alias_idx"
  ON "canonical_occupation_aliases" ("alias");

-- ── Skills ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_skills" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "canonical_name" TEXT NOT NULL,
  "skill_type"     TEXT NOT NULL,
  "source"         TEXT NOT NULL,
  "source_id"      TEXT NOT NULL,
  "source_version" TEXT,
  CONSTRAINT "canonical_skills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canonical_skills_source_source_id_key" UNIQUE ("source", "source_id")
);

CREATE INDEX IF NOT EXISTS "canonical_skills_canonical_name_idx"
  ON "canonical_skills" ("canonical_name");
CREATE INDEX IF NOT EXISTS "canonical_skills_skill_type_idx"
  ON "canonical_skills" ("skill_type");

CREATE TABLE IF NOT EXISTS "canonical_skill_aliases" (
  "id"       UUID NOT NULL DEFAULT gen_random_uuid(),
  "skill_id" UUID NOT NULL,
  "alias"    TEXT NOT NULL,
  CONSTRAINT "canonical_skill_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canonical_skill_aliases_skill_id_fkey"
    FOREIGN KEY ("skill_id")
    REFERENCES "canonical_skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "canonical_skill_aliases_alias_idx"
  ON "canonical_skill_aliases" ("alias");

-- ── Tasks ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_tasks" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "description"    TEXT NOT NULL,
  "source"         TEXT NOT NULL,
  "source_id"      TEXT NOT NULL,
  "source_version" TEXT,
  CONSTRAINT "canonical_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canonical_tasks_source_source_id_key" UNIQUE ("source", "source_id")
);

-- ── Work Activities ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_work_activities" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "name"           TEXT NOT NULL,
  "source"         TEXT NOT NULL,
  "source_id"      TEXT NOT NULL,
  "source_version" TEXT,
  CONSTRAINT "canonical_work_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canonical_work_activities_source_source_id_key" UNIQUE ("source", "source_id")
);

-- ── Industries ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_industries" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "source"         TEXT NOT NULL,
  "source_id"      TEXT NOT NULL,
  "source_version" TEXT,
  CONSTRAINT "canonical_industries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "canonical_industries_source_source_id_key" UNIQUE ("source", "source_id")
);

CREATE INDEX IF NOT EXISTS "canonical_industries_code_idx"
  ON "canonical_industries" ("code");

-- ── Countries ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_countries" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "iso_alpha_2" TEXT NOT NULL,
  "iso_alpha_3" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  CONSTRAINT "canonical_countries_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "canonical_countries_iso_alpha_2_key" UNIQUE ("iso_alpha_2"),
  CONSTRAINT "canonical_countries_iso_alpha_3_key" UNIQUE ("iso_alpha_3")
);

-- ── Time Zones ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_time_zones" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "zone_name"    TEXT NOT NULL,
  "country_code" TEXT NOT NULL,
  CONSTRAINT "canonical_time_zones_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "canonical_time_zones_zone_name_key" UNIQUE ("zone_name"),
  CONSTRAINT "canonical_time_zones_country_code_fkey"
    FOREIGN KEY ("country_code")
    REFERENCES "canonical_countries" ("iso_alpha_2") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ── Languages ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "canonical_languages" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "iso_639_1"   TEXT NOT NULL,
  "iso_639_2"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "native_name" TEXT,
  CONSTRAINT "canonical_languages_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "canonical_languages_iso_639_1_key" UNIQUE ("iso_639_1"),
  CONSTRAINT "canonical_languages_iso_639_2_key" UNIQUE ("iso_639_2")
);

-- ── Event pipeline (Epic 4 Prompt 5) ─────────────────────────────────────────
-- Added here because the Event model references users and was introduced
-- alongside the ontology work.

CREATE TABLE IF NOT EXISTS "events" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "event_type"     TEXT        NOT NULL,
  "aggregate_id"   TEXT        NOT NULL,
  "aggregate_type" TEXT        NOT NULL,
  "user_id"        UUID        NOT NULL,
  "cell_id"        TEXT        NOT NULL,
  "payload"        JSONB       NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'pending',
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at"   TIMESTAMPTZ,
  "retry_count"    INT         NOT NULL DEFAULT 0,
  "correlation_id" TEXT        NOT NULL,
  "error"          TEXT,
  CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "events_user_id_idx"            ON "events" ("user_id");
CREATE INDEX IF NOT EXISTS "events_aggregate_idx"          ON "events" ("aggregate_id", "aggregate_type");
CREATE INDEX IF NOT EXISTS "events_status_idx"             ON "events" ("status");
CREATE INDEX IF NOT EXISTS "events_correlation_id_idx"     ON "events" ("correlation_id");

COMMIT;
