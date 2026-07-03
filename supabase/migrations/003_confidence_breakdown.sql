-- Store the LLM's calibrated conviction in all three directions (buy/sell/hold), not just
-- the winning one, so the detail view can show a real breakdown instead of just one number.
-- Nullable: signals created before this migration won't have it, and that's fine — the UI
-- falls back gracefully rather than fabricating numbers for old rows.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS confidence_breakdown JSONB;
