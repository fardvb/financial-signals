-- Adds real quote symbols for outcome grading, precious metals, and the
-- calibration-memory tables (signal_outcomes, calibration_profiles).
-- Paste into the Supabase SQL editor against the live DB.

-- price_symbol: real quotable proxy for grading (existing tickers are just labels today)
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS price_symbol TEXT;

UPDATE watchlist SET price_symbol = 'SPY'           WHERE ticker = 'SPX';
UPDATE watchlist SET price_symbol = 'QQQ'           WHERE ticker = 'NDX';
UPDATE watchlist SET price_symbol = 'USO'           WHERE ticker = 'WTI';
UPDATE watchlist SET price_symbol = 'GLD'           WHERE ticker = 'GOLD';
UPDATE watchlist SET price_symbol = 'SLV'           WHERE ticker = 'SILVER';
UPDATE watchlist SET price_symbol = 'CPER'          WHERE ticker = 'COPPER';
UPDATE watchlist SET price_symbol = ticker          WHERE ticker IN ('LMT','RTX','TSLA','FCX','COPX');
UPDATE watchlist SET price_symbol = 'OANDA:EUR_USD' WHERE ticker = 'EURUSD';

ALTER TABLE watchlist ALTER COLUMN price_symbol SET NOT NULL;

-- New precious metals. Classified 'industrial' not 'safe-haven': platinum/palladium demand
-- is dominated by autocatalyst/industrial use, unlike gold/silver's monetary-hedge demand.
INSERT INTO watchlist (ticker, name, asset_type, commodity_category, price_symbol) VALUES
  ('PPLT', 'Platinum', 'commodity', 'industrial', 'PPLT'),
  ('PALL', 'Palladium', 'commodity', 'industrial', 'PALL')
ON CONFLICT (ticker) DO NOTHING;

-- Price baseline captured at signal-creation time, so outcomes can be graded later.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS price_at_signal NUMERIC;

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         UUID        NOT NULL UNIQUE REFERENCES signals(id),
  price_at_check    NUMERIC     NOT NULL,
  pct_change        NUMERIC     NOT NULL,
  actual_direction  TEXT        NOT NULL CHECK (actual_direction IN ('buy', 'sell', 'hold')),
  was_correct       BOOLEAN     NOT NULL,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_outcomes_signal_idx ON signal_outcomes (signal_id);

-- Rolling, time-decayed calibration memory per asset/direction/confidence bucket.
-- correct_count/total_count are decayed fractional counters, not raw integer tallies.
CREATE TABLE IF NOT EXISTS calibration_profiles (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           UUID        NOT NULL REFERENCES watchlist(id),
  direction          TEXT        NOT NULL CHECK (direction IN ('buy', 'sell', 'hold')),
  confidence_bucket  TEXT        NOT NULL CHECK (confidence_bucket IN ('low', 'moderate', 'high', 'very_high')),
  correct_count      NUMERIC     NOT NULL DEFAULT 0,
  total_count        NUMERIC     NOT NULL DEFAULT 0,
  last_updated       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, direction, confidence_bucket)
);
