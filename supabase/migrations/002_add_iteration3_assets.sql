-- Iteration 3: expand watchlist with 2 more forex pairs, NVIDIA, Brent oil, and a silver miners ETF.
-- price_symbol conventions follow existing rows: OANDA:XXX_YYY for forex (matches EURUSD row),
-- real ticker for equities/ETFs, proxy ETF ticker for commodities without a direct quotable instrument.

INSERT INTO watchlist (ticker, name, asset_type, commodity_category, price_symbol) VALUES
  ('GBPUSD', 'GBP/USD',                'forex',    NULL,      'OANDA:GBP_USD'),
  ('USDCNH', 'USD/CNH (Yuan)',         'forex',    NULL,      'OANDA:USD_CNH'),
  ('NVDA',   'NVIDIA',                 'equity',   NULL,      'NVDA'),
  ('BRENT',  'Brent Crude Oil',        'commodity','energy',  'BNO'),
  ('SLVP',   'Global Silver Miners',   'equity',   NULL,      'SLVP')
ON CONFLICT (ticker) DO NOTHING;
