-- Iteration 5: three more crypto assets. Requires the 'crypto' asset_type from
-- migration 004. Same BINANCE USDT-pair convention as BTC (USDT ≈ USD; grading
-- uses % change, so the quote currency doesn't affect correctness).

INSERT INTO watchlist (ticker, name, asset_type, commodity_category, price_symbol) VALUES
  ('ETH', 'Ethereum', 'crypto', NULL, 'BINANCE:ETHUSDT'),
  ('XRP', 'XRP',      'crypto', NULL, 'BINANCE:XRPUSDT'),
  ('SOL', 'Solana',   'crypto', NULL, 'BINANCE:SOLUSDT')
ON CONFLICT (ticker) DO NOTHING;
