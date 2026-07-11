# Market Signals

Personal research/education tool that watches financial news and records algorithmic
**buy / sell / hold signal observations** for a fixed watchlist (~24 assets: indices,
commodities, equities, forex, crypto), then **grades its own past signals** against
real price moves so accuracy is measurable.

> ⚠️ This is explicitly **not investment advice** and must never present itself as
> such. All copy says "signal" or "observation", never "recommendation". There is no
> trade execution. A disclaimer banner renders on every page (`src/app/layout.tsx`).
> Keep it that way — it matters more, not less, if this ever becomes a paid product.

## How it works (the whole pipeline)

```
GitHub Actions (every 12h)                GitHub Actions (daily)
        │                                         │
        ▼                                         ▼
  GET /api/ingest ──────────────┐          GET /api/calibrate
   1. Finnhub news per asset    │           1. find signals ≥5 days old, ungraded
   2. Groq LLM triage (8b)      │           2. fetch current price (Finnhub)
   3. Groq LLM synthesis (70b)  │           3. actual move vs threshold → buy/sell/hold
   4. confidence formula        │           4. was_correct → signal_outcomes
   5. insert into `signals` ────┤           5. decayed rollup → calibration_profiles
                                │                    │
                                ▼                    ▼
                     Supabase (Postgres) ◄───────────┘
                                │
                                ▼
              Dashboard (src/app/page.tsx, SSR on every request)
              + client polls /api/quotes ~1/min for live card prices
```

- **Signals are generated twice a day** (cron `0 */12 * * *`) and **graded once,
  5 days after creation** (daily cron `0 6 * * *`; the 5-day rule lives in
  `OUTCOME_GRADING_AGE_DAYS`, not in the schedule).
- **Confidence is a formula, not the LLM's raw guess** (`src/lib/scoring/`): weighted
  blend of LLM confidence, source corroboration, an event-category × asset-class
  weight matrix, and a calibration pull toward the asset's historical hit-rate.
- **Grading formula** (`/api/calibrate` + `OUTCOME_THRESHOLDS`): price change after
  5 days ≥ threshold → actual "buy" move; ≤ −threshold → "sell"; between → "hold".
  Correct = signal direction matches actual. Thresholds per asset type
  (index 1.5%, equity/commodity 2%, forex 0.75%, crypto 3%).

## Stack

| Piece | Choice | Notes |
|---|---|---|
| Framework | Next.js App Router + TypeScript + Tailwind | Deployed on Vercel (Hobby), auto-deploy from `main` |
| Database | Supabase Postgres | Accessed **only** with the service-role key server-side; RLS is enabled with zero policies, so the anon key is inert |
| LLM | Groq (`llama-3.1-8b-instant` triage, `llama-3.3-70b-versatile` synthesis) | Free tier |
| Market data | Finnhub `/quote` + news | Free tier, ~60 calls/min budget |
| Charts / live prices in modal | TradingView embed widgets | Client-side iframes |
| Scheduling | GitHub Actions (`.github/workflows/`) | Vercel Hobby cron only allows daily; Actions gives every-12h |

## Directory map

```
src/app/page.tsx            Dashboard (server component: all queries + quote fetch)
src/app/api/ingest/         News → LLM → signal pipeline (cron, Bearer-guarded)
src/app/api/calibrate/      5-day outcome grading + calibration rollup (cron, guarded)
src/app/api/quotes/         Public live-price endpoint for client polling (CDN-cached)
src/components/AssetGrid.tsx    Client UI shell: header, side menu, filters/sort, cards, modal
src/components/HistoryList.tsx  History tab: graded checks, stats, grading formula
src/components/TradingViewChart.tsx  TradingView embeds (chart + single-quote)
src/lib/scoring/            Confidence formula, event weights, all tunable constants
src/lib/apiAuth.ts          Timing-safe cron auth + failed-attempt rate limiting
src/lib/finnhub/quote.ts    Finnhub /quote wrapper
src/lib/format.ts           Shared display helpers (time-ago, price, colors)
src/types/index.ts          All shared types, incl. DB row shapes
supabase/migrations/        SQL, run manually in the Supabase SQL editor, in order
```

## Data model (Supabase)

- `watchlist` — the assets. `price_symbol` is the *quotable* instrument (e.g. GOLD → GLD
  ETF, EUR/USD → OANDA:EUR_USD, BTC → BINANCE:BTCUSDT); tickers are just labels.
- `signals` — one row per generated observation (direction, confidence, reasoning,
  sources JSON, `price_at_signal`, per-direction `confidence_breakdown`).
- `signal_outcomes` — one row per graded signal (`signal_id` is UNIQUE), written once
  at the 5-day check.
- `calibration_profiles` — decayed hit-rate per (asset, direction, confidence bucket);
  feeds back into future confidence scoring. Counts are exponentially decayed by
  *elapsed time* (half-life ≈ 33 days), so they are not raw integers.

## Environment variables

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | all DB access (server only) |
| `GROQ_API_KEY` | `/api/ingest` |
| `FINNHUB_API_KEY` | quotes + news |
| `CRON_SECRET` | Bearer token for `/api/ingest` and `/api/calibrate` |

GitHub Actions additionally needs secrets `DEPLOY_URL` (the stable production URL —
**not** a redirecting alias, see gotcha #4) and `CRON_SECRET`.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in real values
npm run dev
```

Without `.env.local`, `npm run build` still works for typechecking if you pass dummy
values (the Groq client instantiates at import time):

```bash
GROQ_API_KEY=dummy FINNHUB_API_KEY=dummy NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy npm run build
```

Deploy = push to `main`; Vercel builds automatically. Database migrations are **not**
automatic: paste each new file from `supabase/migrations/` into the Supabase SQL editor.

## Gotchas that have already bitten us (read before "fixing" things)

1. **PostgREST embed shapes flip on UNIQUE FKs.** `signal_outcomes.signal_id` is
   UNIQUE, so embedding it from `signals` returns an *object or null*, not an array.
   `.length` on that null crashed `/api/calibrate` daily for 3 days before anyone
   noticed. Tolerate both shapes.
2. **Calibration decay is time-scaled, not per-run.** The cron polls daily but decay
   is computed from elapsed days. Don't "simplify" it to a flat per-invocation factor.
3. **Finnhub rate budget is 60 calls/min** shared by everything. `/api/quotes` leans
   on the CDN cache (`s-maxage`), ingest sleeps 4s between assets, calibrate sleeps
   1.1s between quotes. Mind the budget when adding features.
4. **`curl -sf` hides redirects and bodies.** A misconfigured `DEPLOY_URL` returning
   a 3xx made every ingest run "succeed" in 8s while doing nothing, for over a day.
   The workflows now print HTTP status + body and fail on non-2xx. A scheduled run
   finishing much faster than ~76s (19+ assets × 4s sleep) means it did no real work.
5. **Watchlist prices are proxy-instrument prices** (ETF $/share, $/lot, $/coin), not
   standardized spot units. Grading is unit-agnostic (% change), display shows unit
   labels. Don't present GLD's share price as the price of an ounce of gold.
6. **eslint `react-hooks/purity`** rejects bare `Date.now()` in component bodies —
   wrap such logic in a helper (see `outcomeGradeCutoffISO`).
7. **Card prices (Finnhub) vs TradingView widgets can differ by ~0.01%.** Different
   fetch moments, same instrument. The Finnhub quote is what grading uses; the
   TradingView widgets are live streams. Not a bug.

## Future direction (not built — don't scaffold prematurely)

A free/premium tier split may happen someday. The prep is architectural, not code:
keep each feature a self-contained component fed by the server page, so gating
becomes a page-level check (Supabase Auth + subscriptions table + RLS policies +
Stripe when the time comes). Also note the data-source free tiers (Finnhub, Groq)
are personal-use — commercial use needs paid plans and a licensing review.
