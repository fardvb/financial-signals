-- Financial Signals schema
-- Run this in the Supabase SQL editor.
-- Cumulative desired state. Incremental changes ship as supabase/migrations/00N_*.sql
-- and are folded in here so a fresh install matches production in one paste.

CREATE TABLE watchlist (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker       TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  asset_type   TEXT        NOT NULL CHECK (asset_type IN ('index', 'commodity', 'equity', 'forex', 'crypto')),
  -- only set for commodities; drives disclaimer copy about asset behaviour
  commodity_category TEXT  CHECK (commodity_category IN ('safe-haven', 'industrial', 'energy')),
  -- real quotable symbol used for outcome grading (ticker above may just be a display label)
  price_symbol TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID        NOT NULL REFERENCES watchlist(id),
  direction         TEXT        NOT NULL CHECK (direction IN ('buy', 'sell', 'hold')),
  confidence        INTEGER     NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasoning         TEXT        NOT NULL,
  -- array of {headline, source, published_at} objects
  sources           JSONB       NOT NULL DEFAULT '[]',
  news_window_start TIMESTAMPTZ NOT NULL,
  -- price of price_symbol captured at signal creation, for later outcome grading
  price_at_signal   NUMERIC,
  -- calibrated confidence for all three directions, e.g. {"buy":62,"sell":15,"hold":38} — null for
  -- signals created before this was tracked
  confidence_breakdown JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX signals_asset_created_idx ON signals (asset_id, created_at DESC);

-- Graded outcome for a signal once its price-check window has passed.
CREATE TABLE signal_outcomes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         UUID        NOT NULL UNIQUE REFERENCES signals(id),
  price_at_check    NUMERIC     NOT NULL,
  pct_change        NUMERIC     NOT NULL,
  actual_direction  TEXT        NOT NULL CHECK (actual_direction IN ('buy', 'sell', 'hold')),
  was_correct       BOOLEAN     NOT NULL,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX signal_outcomes_signal_idx ON signal_outcomes (signal_id);

-- Rolling, time-decayed calibration memory per asset/direction/confidence bucket.
-- correct_count/total_count are decayed fractional counters, not raw integer tallies.
CREATE TABLE calibration_profiles (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           UUID        NOT NULL REFERENCES watchlist(id),
  direction          TEXT        NOT NULL CHECK (direction IN ('buy', 'sell', 'hold')),
  confidence_bucket  TEXT        NOT NULL CHECK (confidence_bucket IN ('low', 'moderate', 'high', 'very_high')),
  correct_count      NUMERIC     NOT NULL DEFAULT 0,
  total_count        NUMERIC     NOT NULL DEFAULT 0,
  last_updated       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, direction, confidence_bucket)
);

-- Seed watchlist
INSERT INTO watchlist (ticker, name, asset_type, commodity_category, price_symbol) VALUES
  ('SPX',    'S&P 500',                'index',     NULL,          'SPY'),
  ('NDX',    'NASDAQ 100',             'index',     NULL,          'QQQ'),
  ('WTI',    'WTI Crude Oil',          'commodity', 'energy',      'USO'),
  ('GOLD',   'Gold',                   'commodity', 'safe-haven',  'GLD'),
  ('SILVER', 'Silver',                 'commodity', 'safe-haven',  'SLV'),
  ('COPPER', 'Copper',                 'commodity', 'industrial',  'CPER'),
  ('PPLT',   'Platinum',               'commodity', 'industrial',  'PPLT'),
  ('PALL',   'Palladium',              'commodity', 'industrial',  'PALL'),
  ('LMT',    'Lockheed Martin',        'equity',    NULL,          'LMT'),
  ('RTX',    'RTX Corp',               'equity',    NULL,          'RTX'),
  ('TSLA',   'Tesla',                  'equity',    NULL,          'TSLA'),
  ('FCX',    'Freeport-McMoRan',       'equity',    NULL,          'FCX'),
  ('COPX',   'Global X Copper Miners', 'equity',    NULL,          'COPX'),
  ('EURUSD', 'EUR/USD',                'forex',     NULL,          'OANDA:EUR_USD'),
  ('GBPUSD', 'GBP/USD',                'forex',     NULL,          'OANDA:GBP_USD'),
  ('USDCNH', 'USD/CNH (Yuan)',         'forex',     NULL,          'OANDA:USD_CNH'),
  ('NVDA',   'NVIDIA',                 'equity',    NULL,          'NVDA'),
  ('BRENT',  'Brent Crude Oil',        'commodity', 'energy',      'BNO'),
  ('SLVP',   'Global Silver Miners',   'equity',    NULL,          'SLVP'),
  ('INTC',   'Intel',                  'equity',    NULL,          'INTC'),
  ('BTC',    'Bitcoin',                'crypto',    NULL,          'BINANCE:BTCUSDT');
