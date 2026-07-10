-- Security hardening: enable Row Level Security on every table.
--
-- All app access goes through the service_role key on the server (which bypasses
-- RLS), so no policies are needed — enabling RLS with zero policies simply makes
-- the anon/publishable key useless for reading or writing anything. Without this,
-- anyone holding the project URL + anon key has full read/write on every table.

ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_profiles ENABLE ROW LEVEL SECURITY;
