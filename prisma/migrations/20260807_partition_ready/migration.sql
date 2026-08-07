-- Partition-Ready Migration for Append-Only Tables
-- Created: 2026-08-07
-- Adds PostgreSQL-native range partitioning on created_at for high-volume
-- append-only tables. This migration is additive: original tables remain
-- untouched. Partitioned copies are created alongside them.
--
-- Partitioned tables:
--   - event_partitioned
--   - application_timeline_partitioned
--   - action_event_partitioned
--   - outcome_event_partitioned
--   - prediction_partitioned
--   - fact_observation_partitioned
--
-- Partitioning strategy: monthly range partitions on created_at
-- Retention: 24 months of partitions (configurable via cron job)

BEGIN;

-- ─── Helper: create monthly partition for a given table ──────────────────────

CREATE OR REPLACE FUNCTION create_monthly_partition(
    p_parent TEXT,
    p_start DATE
)
RETURNS VOID AS $$
DECLARE
    v_end DATE := p_start + INTERVAL '1 month';
    v_partition TEXT := p_parent || '_' || TO_CHAR(p_start, 'YYYY_MM');
    v_sql TEXT;
BEGIN
    v_sql := format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        v_partition, p_parent, p_start, v_end);
    EXECUTE v_sql;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (user_id, created_at)',
        v_partition || '_user_created_idx', v_partition);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (id)',
        v_partition || '_id_idx', v_partition);
END;
$$ LANGUAGE plpgsql;

-- ─── Helper: setup partitioning for a table ──────────────────────────────────

CREATE OR REPLACE FUNCTION setup_table_partition(
    p_table TEXT,
    p_partition_column TEXT
)
RETURNS VOID AS $$
DECLARE
    v_parent TEXT := p_table || '_partitioned';
    v_sql TEXT;
BEGIN
    -- Create partitioned parent table if it doesn't exist
    v_sql := format('CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL) PARTITION BY RANGE (%I)',
        v_parent, p_table, p_partition_column);
    EXECUTE v_sql;

    -- Create current and future partitions (24 months)
    FOR i IN 0..23 LOOP
        PERFORM create_monthly_partition(v_parent,
            DATE_TRUNC('month', CURRENT_DATE) + (i || ' months')::INTERVAL);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ─── Apply partitioning to each table ────────────────────────────────────────

SELECT setup_table_partition('event', 'created_at');
SELECT setup_table_partition('application_timeline', 'created_at');
SELECT setup_table_partition('action_event', 'created_at');
SELECT setup_table_partition('outcome_event', 'created_at');
SELECT setup_table_partition('prediction', 'created_at');
SELECT setup_table_partition('fact_observation', 'observed_at');

-- ─── Routing trigger (deferred activation) ───────────────────────────────────
-- To activate routing for a table, run:
--   CREATE TRIGGER route_event_insert BEFORE INSERT ON event
--     FOR EACH ROW EXECUTE FUNCTION route_event_insert();
--
-- Where route_event_insert() is:
--   CREATE OR REPLACE FUNCTION route_event_insert() RETURNS TRIGGER AS $$
--   BEGIN
--     INSERT INTO event_partitioned VALUES (NEW.*);
--     RETURN NULL;
--   END;
--   $$ LANGUAGE plpgsql;

-- ─── Cleanup helper functions ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS create_monthly_partition;
DROP FUNCTION IF EXISTS setup_table_partition;

COMMIT;
