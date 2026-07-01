-- Financial Signals schema
-- Run this in the Supabase SQL editor

CREATE TABLE watchlist (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker       TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  asset_type   TEXT        NOT NULL CHECK (asset_type IN ('index', 'commodity', 'equity', 'forex')),
  -- only set for commodities; drives disclaimer copy about asset behaviour
  commodity_category TEXT  CHECK (commodity_category IN ('safe-haven', 'industrial', 'energy')),
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
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX signals_asset_created_idx ON signals (asset_id, created_at DESC);

-- Seed watchlist
INSERT INTO watchlist (ticker, name, asset_type, commodity_category) VALUES
  ('SPX',    'S&P 500',          'index',     NULL),
  ('NDX',    'NASDAQ 100',       'index',     NULL),
  ('WTI',    'WTI Crude Oil',    'commodity', 'energy'),
  ('GOLD',   'Gold',             'commodity', 'safe-haven'),
  ('SILVER', 'Silver',           'commodity', 'safe-haven'),
  ('COPPER', 'Copper',           'commodity', 'industrial'),
  ('LMT',    'Lockheed Martin',  'equity',    NULL),
  ('RTX',    'RTX Corp',         'equity',    NULL),
  ('TSLA',   'Tesla',            'equity',    NULL),
  ('FCX',    'Freeport-McMoRan',        'equity',    NULL),
  ('COPX',   'Global X Copper Miners', 'equity',    NULL),
  ('EURUSD', 'EUR/USD',                'forex',     NULL);
