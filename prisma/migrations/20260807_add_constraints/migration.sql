-- Add check constraints for enum-like string fields
-- Created: 2026-08-07
-- These constraints enforce data integrity on fields that have a limited
-- set of valid values but are stored as strings.

BEGIN;

-- Event status: pending, processing, completed, failed, dlq
ALTER TABLE events ADD CONSTRAINT event_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dlq'));

-- Outcome event status: EXPLICIT, INFERRED, USER_REPORTED
ALTER TABLE outcome_events ADD CONSTRAINT outcome_event_status_check CHECK (outcome_status IN ('EXPLICIT', 'INFERRED', 'USER_REPORTED'));

-- Outcome event category: POSITIVE, NEGATIVE, NEUTRAL, TERMINAL
ALTER TABLE outcome_events ADD CONSTRAINT outcome_event_category_check CHECK (outcome_category IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'TERMINAL'));

-- User resume scanning status: pending, scanning, clean, infected
ALTER TABLE user_resumes ADD CONSTRAINT user_resume_scanning_status_check CHECK (scanning_status IS NULL OR scanning_status IN ('pending', 'scanning', 'clean', 'infected'));

-- User resume status: pending, active, superseded, deleted
ALTER TABLE user_resumes ADD CONSTRAINT user_resume_status_check CHECK (status IS NULL OR status IN ('pending', 'active', 'superseded', 'deleted'));

-- Action event source type: USER_ACTION, SYSTEM_TRACKED, IMPORTED
ALTER TABLE action_events ADD CONSTRAINT action_event_source_type_check CHECK (source_type IN ('USER_ACTION', 'SYSTEM_TRACKED', 'IMPORTED'));

COMMIT;
