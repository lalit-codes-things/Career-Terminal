-- Interview Intelligence, additive migration
-- Created: 2026-08-07

-- ─── Interview Sessions ─────────────────────────────────────────────────────
-- Aggregate root for one interview process at one company for one role.

CREATE TABLE IF NOT EXISTS interview_sessions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    canonical_company_id        UUID REFERENCES canonical_companies(id) ON DELETE SET NULL,
    company_name_raw            TEXT,
    role_title                  TEXT NOT NULL,
    job_level                   TEXT NOT NULL,
    loop_type                   TEXT NOT NULL,
    source_type                 TEXT NOT NULL,
    source_opportunity_id       UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    source_application_id       UUID REFERENCES job_applications(id) ON DELETE SET NULL,
    s3_key                      TEXT,
    raw_transcript              TEXT,
    status                      TEXT NOT NULL DEFAULT 'SCHEDULED',
    final_decision              TEXT,
    offer_extended              BOOLEAN,
    offer_accepted              BOOLEAN,
    share_for_global_intelligence BOOLEAN NOT NULL DEFAULT false,
    confidence                  DOUBLE PRECISION DEFAULT 1.0,
    valid_from                  TIMESTAMPTZ,
    valid_to                    TIMESTAMPTZ,
    transaction_start           TIMESTAMPTZ,
    transaction_end             TIMESTAMPTZ,
    is_current                  BOOLEAN DEFAULT true,
    superseded_by_id            UUID REFERENCES interview_sessions(id) ON DELETE SET NULL,
    superseded_at               TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at                  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    version                     INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_status ON interview_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_current ON interview_sessions(user_id, is_current);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_canonical_company ON interview_sessions(canonical_company_id);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_validity ON interview_sessions(user_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_share_global ON interview_sessions(share_for_global_intelligence);

-- ─── Interview Rounds ───────────────────────────────────────────────────────
-- Individual round within an interview session.

CREATE TABLE IF NOT EXISTS interview_rounds (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round_type       TEXT NOT NULL,
    sequence_number  INTEGER DEFAULT 0,
    interviewer_label TEXT,
    duration_minutes INTEGER,
    outcome_score    DOUBLE PRECISION,
    outcome_label    TEXT,
    notes            TEXT,
    confidence       DOUBLE PRECISION DEFAULT 1.0,
    created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    version          INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_interview_rounds_session ON interview_rounds(session_id);
CREATE INDEX IF NOT EXISTS idx_interview_rounds_user_type ON interview_rounds(user_id, round_type);

-- ─── Interview Events ───────────────────────────────────────────────────────
-- Granular events within an interview session or round.

CREATE TABLE IF NOT EXISTS interview_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id        UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    round_id          UUID REFERENCES interview_rounds(id) ON DELETE SET NULL,
    event_type        TEXT NOT NULL,
    event_category    TEXT NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT,
    effective_date    TIMESTAMPTZ,
    valid_from        TIMESTAMPTZ,
    valid_to          TIMESTAMPTZ,
    transaction_start TIMESTAMPTZ,
    transaction_end   TIMESTAMPTZ,
    sequence_number   INTEGER DEFAULT 0,
    confidence        DOUBLE PRECISION DEFAULT 1.0,
    is_current        BOOLEAN DEFAULT true,
    superseded_by_id  UUID REFERENCES interview_events(id) ON DELETE SET NULL,
    superseded_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    version           INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_interview_events_user_type ON interview_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_interview_events_session ON interview_events(session_id);
CREATE INDEX IF NOT EXISTS idx_interview_events_round ON interview_events(round_id);

-- ─── Interview Signals ──────────────────────────────────────────────────────
-- Inferred signals from interview events.

CREATE TABLE IF NOT EXISTS interview_signals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id        UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    round_id          UUID REFERENCES interview_rounds(id) ON DELETE SET NULL,
    signal_type       TEXT NOT NULL,
    signal_category   TEXT NOT NULL,
    signal_name       TEXT NOT NULL,
    signal_value      JSONB NOT NULL,
    source_event_id   UUID REFERENCES interview_events(id) ON DELETE SET NULL,
    confidence        DOUBLE PRECISION DEFAULT 1.0,
    valid_from        TIMESTAMPTZ,
    valid_to          TIMESTAMPTZ,
    is_current        BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interview_signals_user_type ON interview_signals(user_id, signal_type);
CREATE INDEX IF NOT EXISTS idx_interview_signals_session ON interview_signals(session_id);

-- ─── Interview Competencies ─────────────────────────────────────────────────
-- Catalog of competencies observed in interviews.

CREATE TABLE IF NOT EXISTS interview_competencies (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                  TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    category             TEXT NOT NULL,
    parent_competency_id UUID REFERENCES interview_competencies(id) ON DELETE SET NULL,
    description          TEXT,
    is_active            BOOLEAN DEFAULT true,
    created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interview_competencies_category ON interview_competencies(category);
CREATE INDEX IF NOT EXISTS idx_interview_competencies_parent ON interview_competencies(parent_competency_id);

-- ─── Interview Competency Observations ──────────────────────────────────────
-- Fact-level record of a demonstrated competency in a session or round.

CREATE TABLE IF NOT EXISTS interview_competency_observations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id          UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    round_id            UUID REFERENCES interview_rounds(id) ON DELETE SET NULL,
    competency_id       UUID NOT NULL REFERENCES interview_competencies(id) ON DELETE RESTRICT,
    demonstrated_level  DOUBLE PRECISION NOT NULL,
    evidence_excerpt    TEXT,
    source_event_id     UUID REFERENCES interview_events(id) ON DELETE SET NULL,
    confidence          DOUBLE PRECISION DEFAULT 1.0,
    valid_from          TIMESTAMPTZ,
    is_current          BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interview_competency_observations_user_competency ON interview_competency_observations(user_id, competency_id);
CREATE INDEX IF NOT EXISTS idx_interview_competency_observations_session ON interview_competency_observations(session_id);
CREATE INDEX IF NOT EXISTS idx_interview_competency_observations_competency ON interview_competency_observations(competency_id);

-- ─── Interview Knowledge Patterns ───────────────────────────────────────────
-- Cross-user discovered patterns (populated by analytics pipelines).

CREATE TABLE IF NOT EXISTS interview_knowledge_patterns (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_type           TEXT NOT NULL,
    scope                  TEXT NOT NULL,
    canonical_company_id   UUID REFERENCES canonical_companies(id) ON DELETE SET NULL,
    role_title_normalized  TEXT,
    competency_id          UUID REFERENCES interview_competencies(id) ON DELETE SET NULL,
    pattern_data           JSONB NOT NULL,
    distinct_user_count    INTEGER NOT NULL,
    distinct_session_count INTEGER NOT NULL,
    statistical_confidence DOUBLE PRECISION,
    window_start           TIMESTAMPTZ NOT NULL,
    window_end             TIMESTAMPTZ NOT NULL,
    computed_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    is_published           BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_interview_knowledge_patterns_type_scope ON interview_knowledge_patterns(pattern_type, scope);
CREATE INDEX IF NOT EXISTS idx_interview_knowledge_patterns_company ON interview_knowledge_patterns(canonical_company_id);
CREATE INDEX IF NOT EXISTS idx_interview_knowledge_patterns_role ON interview_knowledge_patterns(role_title_normalized);
CREATE INDEX IF NOT EXISTS idx_interview_knowledge_patterns_published ON interview_knowledge_patterns(is_published);
