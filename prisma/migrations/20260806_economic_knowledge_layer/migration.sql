-- Economic Knowledge Layer (Epic 7) — Additive Migration
-- Created: 2026-08-06
-- Describes the minimum additive schema for representing economic concepts
-- in the Career Terminal knowledge graph.

-- ─── Economic Documents ────────────────────────────────────────────────────
-- Represents any economic document: offer letters, pay stubs, equity grants,
-- promotion letters, tax forms, contractor agreements, severance agreements, etc.

CREATE TABLE IF NOT EXISTS economic_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type     TEXT NOT NULL,
    document_category TEXT NOT NULL,
    title             TEXT,
    source_name       TEXT,
    source_uri        TEXT,
    s3_key            TEXT,
    mime_type         TEXT,
    raw_text          TEXT,
    extracted_json    JSONB,
    extraction_method TEXT,
    model_version     TEXT,
    confidence        DOUBLE PRECISION DEFAULT 1.0,
    valid_from        TIMESTAMPTZ,
    valid_to          TIMESTAMPTZ,
    transaction_start TIMESTAMPTZ,
    transaction_end   TIMESTAMPTZ,
    currency          TEXT,
    locale            TEXT,
    is_current        BOOLEAN DEFAULT true,
    superseded_by_id  UUID REFERENCES economic_documents(id) ON DELETE SET NULL,
    superseded_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    version           INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_economic_documents_user_type ON economic_documents(user_id, document_type);
CREATE INDEX IF NOT EXISTS idx_economic_documents_user_category ON economic_documents(user_id, document_category);
CREATE INDEX IF NOT EXISTS idx_economic_documents_user_validity ON economic_documents(user_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_economic_documents_user_current ON economic_documents(user_id, is_current);
CREATE INDEX IF NOT EXISTS idx_economic_documents_s3_key ON economic_documents(s3_key);

-- ─── Economic Events ───────────────────────────────────────────────────────
-- Represents an economic event in the user's career trajectory:
-- Offer → Promotion → Bonus → Equity → Refresh → Role Change → Severance → Career Wealth

CREATE TABLE IF NOT EXISTS economic_events (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type             TEXT NOT NULL,
    event_category         TEXT NOT NULL,
    source_document_id     UUID REFERENCES economic_documents(id) ON DELETE SET NULL,
    source_opportunity_id  UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    source_application_id  UUID REFERENCES job_applications(id) ON DELETE SET NULL,
    source_fact_id         UUID REFERENCES fact_observations(id) ON DELETE SET NULL,
    entity_id              TEXT,
    entity_type            TEXT,
    title                  TEXT,
    description            TEXT,
    amount                 DECIMAL(18, 2),
    currency               TEXT,
    effective_date         TIMESTAMPTZ,
    valid_from             TIMESTAMPTZ,
    valid_to               TIMESTAMPTZ,
    transaction_start      TIMESTAMPTZ,
    transaction_end        TIMESTAMPTZ,
    sequence_number        INTEGER DEFAULT 0,
    confidence             DOUBLE PRECISION DEFAULT 1.0,
    is_current             BOOLEAN DEFAULT true,
    superseded_by_id       UUID REFERENCES economic_events(id) ON DELETE SET NULL,
    superseded_at          TIMESTAMPTZ,
    created_at             TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at             TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    version                INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_economic_events_user_type ON economic_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_economic_events_user_category ON economic_events(user_id, event_category);
CREATE INDEX IF NOT EXISTS idx_economic_events_user_effective_date ON economic_events(user_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_economic_events_user_validity ON economic_events(user_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_economic_events_user_current ON economic_events(user_id, is_current);
CREATE INDEX IF NOT EXISTS idx_economic_events_source_document ON economic_events(source_document_id);
CREATE INDEX IF NOT EXISTS idx_economic_events_source_opportunity ON economic_events(source_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_economic_events_source_application ON economic_events(source_application_id);

-- ─── Economic Signals ──────────────────────────────────────────────────────
-- Reusable inferred economic signals for the Planner to reason over:
-- Offer Competitiveness, Negotiation Leverage, Market Premium, Promotion Probability,
-- Salary Compression, Recruiter Urgency, Hiring Budget Strength, Career Wealth Trajectory, etc.

CREATE TABLE IF NOT EXISTS economic_signals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    signal_type       TEXT NOT NULL,
    signal_category   TEXT NOT NULL,
    signal_name       TEXT NOT NULL,
    signal_value      JSONB NOT NULL,
    source_event_id   UUID REFERENCES economic_events(id) ON DELETE SET NULL,
    source_fact_id    UUID REFERENCES fact_observations(id) ON DELETE SET NULL,
    source_document_id UUID REFERENCES economic_documents(id) ON DELETE SET NULL,
    entity_id         TEXT,
    entity_type       TEXT,
    confidence        DOUBLE PRECISION DEFAULT 1.0,
    valid_from        TIMESTAMPTZ,
    valid_to          TIMESTAMPTZ,
    is_current        BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_economic_signals_user_type ON economic_signals(user_id, signal_type);
CREATE INDEX IF NOT EXISTS idx_economic_signals_user_category ON economic_signals(user_id, signal_category);
CREATE INDEX IF NOT EXISTS idx_economic_signals_user_name ON economic_signals(user_id, signal_name);
CREATE INDEX IF NOT EXISTS idx_economic_signals_user_current ON economic_signals(user_id, is_current);
CREATE INDEX IF NOT EXISTS idx_economic_signals_source_event ON economic_signals(source_event_id);
CREATE INDEX IF NOT EXISTS idx_economic_signals_source_fact ON economic_signals(source_fact_id);
CREATE INDEX IF NOT EXISTS idx_economic_signals_source_document ON economic_signals(source_document_id);