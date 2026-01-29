-- Migration 003: One-Attempt-Per-Day System for BITBRICK
-- Adds attempt tracking columns to tournament_entries

-- Add columns for tracking single attempt per day
ALTER TABLE tournament_entries
ADD COLUMN IF NOT EXISTS attempt_used BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS attempt_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS attempt_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS game_session_id UUID;

-- Index for fast lookup of attempt status
CREATE INDEX IF NOT EXISTS idx_entries_attempt_used ON tournament_entries(tournament_id, user_id, attempt_used);

-- Add constraint to ensure only one completed attempt per user per tournament
-- (The combination of attempt_used and attempt_completed_at handles this)

-- View for getting today's active entries with attempt status
CREATE OR REPLACE VIEW tournament_entry_status AS
SELECT
  te.id,
  te.tournament_id,
  te.user_id,
  te.best_score,
  te.attempt_used,
  te.attempt_started_at,
  te.attempt_completed_at,
  u.display_name,
  t.date as tournament_date,
  t.status as tournament_status,
  CASE
    WHEN te.attempt_completed_at IS NOT NULL THEN 'completed'
    WHEN te.attempt_started_at IS NOT NULL THEN 'in_progress'
    ELSE 'ready'
  END as attempt_status
FROM tournament_entries te
JOIN users u ON te.user_id = u.id
JOIN tournaments t ON te.tournament_id = t.id;
