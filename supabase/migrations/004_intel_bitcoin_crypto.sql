-- Iteration 4: add Intel and Bitcoin. Bitcoin introduces a new 'crypto' asset_type,
-- which requires widening the watchlist CHECK constraint first.
-- price_symbol for BTC is Finnhub's exchange-prefixed crypto symbol (USDT ≈ USD;
-- grading uses % change, so the quote currency choice doesn't affect correctness).

ALTER TABLE watchlist DROP CONSTRAINT watchlist_asset_type_check;
ALTER TABLE watchlist ADD CONSTRAINT watchlist_asset_type_check
  CHECK (asset_type IN ('index', 'commodity', 'equity', 'forex', 'crypto'));

INSERT INTO watchlist (ticker, name, asset_type, commodity_category, price_symbol) VALUES
  ('INTC', 'Intel',   'equity', NULL, 'INTC'),
  ('BTC',  'Bitcoin', 'crypto', NULL, 'BINANCE:BTCUSDT')
ON CONFLICT (ticker) DO NOTHING;
