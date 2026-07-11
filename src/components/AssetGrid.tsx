'use client'

import { useMemo, useState } from 'react'
import type { AssetType, OutcomeWithSignal, SignalDirection, SignalSource, WatchlistAsset } from '@/types'
import type { SignalRow } from '@/app/page'
import TradingViewChart, {
  tradingViewSymbol,
  TradingViewSingleQuote,
  TradingViewTickerTape,
} from '@/components/TradingViewChart'
import HistoryList from '@/components/HistoryList'
import { ASSET_TYPE_LABELS, directionColors, formatPrice, timeAgo } from '@/lib/format'

export interface CardData {
  asset: WatchlistAsset
  latest: SignalRow | undefined
  history: SignalRow[]
  accuracy: { rate: number; n: number } | null
  price: number | null
}

type DirectionFilter = 'all' | SignalDirection
type AssetTypeFilter = 'all' | AssetType
type Tab = 'signals' | 'history'

// Source URLs come from third-party news data; never render a non-http(s)
// scheme (javascript:, data:) as a clickable link.
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

// Displayed breakdown is normalized to sum to 100% for readability, even though the
// underlying confidence_breakdown values are independent per-direction conviction scores
// (deliberately not constrained to sum to 100 — see confidence.ts). Largest-remainder
// rounding keeps the displayed percentages summing exactly to 100.
function normalizeBreakdown(raw: Partial<Record<SignalDirection, number>>): Record<SignalDirection, number> {
  const directions: SignalDirection[] = ['buy', 'sell', 'hold']
  const values = directions.map(d => Math.max(0, raw[d] ?? 0))
  const total = values.reduce((a, b) => a + b, 0)
  if (total === 0) return { buy: 0, sell: 0, hold: 0 }

  const shares = values.map(v => (v / total) * 100)
  const floors = shares.map(Math.floor)
  const remainder = 100 - floors.reduce((a, b) => a + b, 0)

  const order = shares
    .map((share, i) => ({ i, frac: share - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < remainder; k++) floors[order[k].i] += 1

  return { buy: floors[0], sell: floors[1], hold: floors[2] }
}

function assetTypeBadge(asset: WatchlistAsset): string {
  if (asset.commodity_category === 'safe-haven') return 'Safe Haven'
  if (asset.commodity_category === 'industrial') return 'Industrial'
  if (asset.commodity_category === 'energy') return 'Energy'
  if (asset.asset_type === 'index') return 'Index'
  if (asset.asset_type === 'forex') return 'Forex'
  if (asset.asset_type === 'crypto') return 'Crypto'
  return 'Equity'
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-zinc-100 text-zinc-900 border-zinc-100'
          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function priceUnit(asset: WatchlistAsset): string {
  if (asset.asset_type === 'forex') return ' $/lot'
  if (asset.asset_type === 'crypto') return ' $/coin'
  return ' $/share'
}

function PriceLine({ asset, price }: { asset: WatchlistAsset; price: number | null }) {
  if (price == null) return null
  return (
    <span className="text-sm text-zinc-300 tabular-nums">
      {asset.asset_type === 'forex' ? '' : '$'}{formatPrice(price)}
      <span className="text-zinc-500">{priceUnit(asset)}</span>
    </span>
  )
}

function AssetCard({ data, onOpen }: { data: CardData; onOpen: () => void }) {
  const { asset, latest, history, accuracy, price } = data
  const colors = latest ? directionColors(latest.direction) : null

  return (
    <button
      onClick={onOpen}
      data-testid={`asset-card-${asset.ticker}`}
      className="text-left rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3 transition-colors hover:border-zinc-600 hover:bg-zinc-850 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100">{asset.ticker}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {assetTypeBadge(asset)}
            </span>
            <PriceLine asset={asset} price={price} />
          </div>
          <div className="text-sm text-zinc-400 mt-0.5">{asset.name}</div>
        </div>

        {latest && colors ? (
          <div className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${colors.badge}`}>
            {latest.direction}
          </div>
        ) : (
          <div className="shrink-0 text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-600">
            no signal
          </div>
        )}
      </div>

      {latest ? (
        <>
          <div>
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>Confidence</span>
              <span>{latest.confidence}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-sky-500" style={{ width: `${latest.confidence}%` }} />
            </div>
          </div>

          <p className="text-sm text-zinc-300 leading-relaxed">{latest.reasoning}</p>

          {accuracy && (
            <div className="text-xs text-zinc-500">
              Historical accuracy: {Math.round(accuracy.rate * 100)}% (n={Math.round(accuracy.n)})
            </div>
          )}

          {latest.sources.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-zinc-500 uppercase tracking-wide">Sources</div>
              {(latest.sources as SignalSource[]).slice(0, 3).map((s, i) => (
                <div key={i} className="text-xs text-zinc-400 leading-snug">
                  <span className="text-zinc-500">{s.source} · </span>
                  {s.headline}
                </div>
              ))}
              {latest.sources.length > 3 && (
                <div className="text-xs text-zinc-600">+{latest.sources.length - 3} more — click for details</div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
            <div className="flex items-center gap-1.5">
              {history.map((s, i) => (
                <div
                  key={i}
                  title={`${s.direction} · ${s.confidence}% · ${new Date(s.created_at).toLocaleDateString()}`}
                  className={`w-2 h-2 rounded-full ${directionColors(s.direction).dot} ${i === 0 ? 'opacity-100' : 'opacity-40'}`}
                />
              ))}
            </div>
            <span className="text-xs text-zinc-600">{timeAgo(latest.created_at)}</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-zinc-600 italic">
          Signal will appear after the first pipeline run.
        </div>
      )}
    </button>
  )
}

function AssetDetailModal({ data, onClose }: { data: CardData; onClose: () => void }) {
  const { asset, latest, accuracy, price } = data
  const colors = latest ? directionColors(latest.direction) : null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4 md:p-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-semibold text-zinc-100">{asset.ticker}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {assetTypeBadge(asset)}
              </span>
              <PriceLine asset={asset} price={price} />
            </div>
            <div className="text-sm text-zinc-400 mt-0.5">{asset.name}</div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-zinc-500 hover:text-zinc-200 text-sm px-2 py-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-1.5">
          <TradingViewSingleQuote asset={asset} />
          <TradingViewChart asset={asset} />
          <div className="text-xs text-zinc-600">
            Live price &amp; chart: {tradingViewSymbol(asset)} (TradingView) — the instrument this asset&apos;s
            signals are quoted and graded against. The price in the header above is the Finnhub snapshot taken
            when the page loaded (the feed grading uses); a small gap vs. the live stream is timing, not an error.
          </div>
        </div>

        {latest && colors ? (
          <>
            <div className="flex items-center gap-3">
              <div className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${colors.badge}`}>
                {latest.direction}
              </div>
              <div className="text-xs text-zinc-500">{timeAgo(latest.created_at)}</div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>Confidence</span>
                <span>{latest.confidence}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${latest.confidence}%` }} />
              </div>
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed">{latest.reasoning}</p>

            {accuracy && (
              <div className="text-xs text-zinc-500">
                Historical accuracy: {Math.round(accuracy.rate * 100)}% (n={Math.round(accuracy.n)})
              </div>
            )}

            {latest.sources.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-zinc-500 uppercase tracking-wide">All sources</div>
                {(latest.sources as SignalSource[]).map((s, i) =>
                  s.url && isSafeUrl(s.url) ? (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-sky-400 hover:text-sky-300 hover:underline leading-snug"
                    >
                      <span className="text-zinc-500">{s.source} · </span>
                      {s.headline}
                    </a>
                  ) : (
                    <div key={i} className="text-xs text-zinc-400 leading-snug">
                      <span className="text-zinc-500">{s.source} · </span>
                      {s.headline}
                    </div>
                  )
                )}
              </div>
            )}

            {latest.confidence_breakdown ? (
              <div className="space-y-2 pt-2 border-t border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wide">Confidence by direction</div>
                {(() => {
                  const normalized = normalizeBreakdown(latest.confidence_breakdown)
                  return (['buy', 'sell', 'hold'] as SignalDirection[]).map(d => {
                    const value = normalized[d]
                    const barColor = d === 'buy' ? 'bg-emerald-500' : d === 'sell' ? 'bg-red-500' : 'bg-zinc-500'
                    return (
                      <div key={d}>
                        <div className="flex justify-between text-xs text-zinc-500 mb-1">
                          <span className="capitalize">{d}</span>
                          <span>{value}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-800">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${value}%` }} />
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            ) : (
              <div className="text-xs text-zinc-600 italic pt-2 border-t border-zinc-800">
                Per-direction breakdown not available for this signal (generated before this feature shipped).
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-zinc-600 italic">
            Signal will appear after the first pipeline run.
          </div>
        )}
      </div>
    </div>
  )
}

function SearchBox({
  cards,
  query,
  onQueryChange,
  onPick,
}: {
  cards: CardData[]
  query: string
  onQueryChange: (q: string) => void
  onPick: (card: CardData) => void
}) {
  const [open, setOpen] = useState(false)

  const q = query.trim().toLowerCase()
  const suggestions =
    q === ''
      ? []
      : cards
          .filter(c => c.asset.ticker.toLowerCase().includes(q) || c.asset.name.toLowerCase().includes(q))
          .sort((a, b) => {
            const starts = (c: CardData) =>
              c.asset.ticker.toLowerCase().startsWith(q) || c.asset.name.toLowerCase().startsWith(q) ? 0 : 1
            return starts(a) - starts(b)
          })
          .slice(0, 6)

  return (
    <div className="relative">
      <svg
        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={query}
        onChange={e => { onQueryChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === 'Enter' && suggestions.length > 0) {
            onPick(suggestions[0])
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
        placeholder="Search assets…"
        aria-label="Search assets"
        data-testid="asset-search"
        className="w-40 sm:w-56 bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl overflow-hidden z-50">
          {suggestions.map(s => (
            <button
              key={s.asset.id}
              // onMouseDown so the pick lands before the input's blur closes the list
              onMouseDown={e => { e.preventDefault(); onPick(s) }}
              className="w-full text-left px-3 py-2 hover:bg-zinc-800 flex items-center justify-between gap-3"
            >
              <span className="text-sm font-medium text-zinc-100">{s.asset.ticker}</span>
              <span className="text-xs text-zinc-500 truncate">{s.asset.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AssetGrid({
  cards,
  outcomes,
  pendingCount,
  outcomesCapped,
  latestRun,
}: {
  cards: CardData[]
  outcomes: OutcomeWithSignal[]
  pendingCount: number
  outcomesCapped: boolean
  latestRun?: string
}) {
  const [tab, setTab] = useState<Tab>('signals')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [assetType, setAssetType] = useState<AssetTypeFilter>('all')
  const [selected, setSelected] = useState<CardData | null>(null)
  const [query, setQuery] = useState('')

  // Stable identities so the ticker-tape effect doesn't reload the widget on
  // every filter click re-render.
  const tickerAssets = useMemo(() => cards.map(c => c.asset), [cards])
  const cardByAssetId = useMemo(() => new Map(cards.map(c => [c.asset.id, c])), [cards])

  const q = query.trim().toLowerCase()
  const matchesText = (asset: WatchlistAsset) =>
    q === '' || asset.ticker.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q)

  const filtered = cards.filter(c => {
    if (direction !== 'all' && c.latest?.direction !== direction) return false
    if (assetType !== 'all' && c.asset.asset_type !== assetType) return false
    return matchesText(c.asset)
  })

  // The same menu-bar filters drive the history tab: direction matches the
  // signal's call (not the actual outcome), type/search match the asset.
  const filteredOutcomes = outcomes.filter(o => {
    if (direction !== 'all' && o.signals.direction !== direction) return false
    if (assetType !== 'all' && o.signals.watchlist.asset_type !== assetType) return false
    return matchesText(o.signals.watchlist)
  })

  const countLabel =
    tab === 'signals'
      ? `${filtered.length} of ${cards.length} assets`
      : `${filteredOutcomes.length} of ${outcomes.length} checks`

  return (
    <div>
      <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
        <div className="px-6 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-5 min-w-0">
            <div className="min-w-0">
              <h1 className="font-semibold text-zinc-100 tracking-tight">Market Signals</h1>
              <p className="text-xs text-zinc-500">Personal observation tool</p>
            </div>
            <nav className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5" data-testid="tab-bar">
              {(['signals', 'history'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  aria-pressed={tab === t}
                  data-testid={`tab-${t}`}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                    tab === t ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t === 'signals' ? 'Signals' : 'History'}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {latestRun && (
              <div className="hidden sm:block text-xs text-zinc-500 whitespace-nowrap">Updated {timeAgo(latestRun)}</div>
            )}
            <SearchBox
              cards={cards}
              query={query}
              onQueryChange={setQuery}
              onPick={card => { setSelected(card); setQuery('') }}
            />
          </div>
        </div>

        <div className="px-6 pb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5" data-testid="direction-filters">
            <span className="text-xs text-zinc-600 mr-1">Direction</span>
            {(['all', 'buy', 'sell', 'hold'] as DirectionFilter[]).map(d => (
              <FilterChip key={d} active={direction === d} onClick={() => setDirection(d)}>
                {d === 'all' ? 'All' : d[0].toUpperCase() + d.slice(1)}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-1.5" data-testid="type-filters">
            <span className="text-xs text-zinc-600 mr-1">Type</span>
            {(['all', 'index', 'commodity', 'equity', 'forex', 'crypto'] as AssetTypeFilter[]).map(t => (
              <FilterChip key={t} active={assetType === t} onClick={() => setAssetType(t)}>
                {t === 'all' ? 'All' : ASSET_TYPE_LABELS[t]}
              </FilterChip>
            ))}
          </div>
          <span className="text-xs text-zinc-600">{countLabel}</span>
        </div>
      </header>

      <TradingViewTickerTape assets={tickerAssets} />

      {tab === 'signals' ? (
        <div className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(data => (
            <AssetCard key={data.asset.id} data={data} onOpen={() => setSelected(data)} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-sm text-zinc-600 py-10">
              No assets match these filters.
            </div>
          )}
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-6">
          <HistoryList
            outcomes={filteredOutcomes}
            pendingCount={pendingCount}
            lastCheckedAt={outcomes[0]?.checked_at}
            capped={outcomesCapped}
            onOpenAsset={assetId => {
              const card = cardByAssetId.get(assetId)
              if (card) setSelected(card)
            }}
          />
        </div>
      )}

      {selected && <AssetDetailModal data={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
