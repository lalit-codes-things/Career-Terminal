-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: 20260805000002_drop_taxonomy_tables
-- Wave 4 Step 12 — Remove canonical_skills / canonical_occupations and their
-- dependent tables.  Iso/timezone tables are NOT dropped (see note below).
--
-- Tables dropped:
--   occupation_classification_mapping
--   occupation_hierarchy
--   occupation_skill
--   skill_relationship
--   canonical_skill_aliases
--   canonical_occupation_aliases
--   canonical_tasks
--   canonical_work_activities
--   canonical_industries
--   canonical_skills
--   canonical_occupations
--   ontology_sources
--
-- Tables KEPT (external interoperability value, no migration risk):
--   canonical_countries     — ISO 3166-1 (referenced by address normalisation)
--   canonical_time_zones    — IANA tz (referenced by user timezone validation)
--   canonical_languages     — ISO 639
--   canonical_currencies    — ISO 4217
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop dependent join/mapping tables first to satisfy FK constraints

DROP TABLE IF EXISTS "occupation_classification_mapping" CASCADE;
DROP TABLE IF EXISTS "occupation_hierarchy"              CASCADE;
DROP TABLE IF EXISTS "occupation_skill"                  CASCADE;
DROP TABLE IF EXISTS "skill_relationship"                CASCADE;
DROP TABLE IF EXISTS "canonical_skill_aliases"           CASCADE;
DROP TABLE IF EXISTS "canonical_occupation_aliases"      CASCADE;
DROP TABLE IF EXISTS "canonical_tasks"                   CASCADE;
DROP TABLE IF EXISTS "canonical_work_activities"         CASCADE;
DROP TABLE IF EXISTS "canonical_industries"              CASCADE;

-- Drop root taxonomy tables
DROP TABLE IF EXISTS "canonical_skills"      CASCADE;
DROP TABLE IF EXISTS "canonical_occupations" CASCADE;
DROP TABLE IF EXISTS "ontology_sources"      CASCADE;
