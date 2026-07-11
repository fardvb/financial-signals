'use client'

// The whole interactive dashboard shell: sticky header (search + hamburger),
// side menu (Signals/History nav, direction/type filters, price sort), the
// asset card grid, the History tab, and the per-asset detail modal. Gets all
// data as props from the server page; its only own fetch is /api/quotes polling.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { AssetType, OutcomeWithSignal, SignalDirection, SignalSource, WatchlistAsset } from '@/types'
import type { SignalRow } from '@/app/page'
import TradingViewChart, { tradingViewSymbol, TradingViewSingleQuote } from '@/components/TradingViewChart'
import HistoryList from '@/components/HistoryList'
import FilterChip from '@/components/FilterChip'
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
type PriceSort = 'default' | 'high' | 'low'
type Tab = 'signals' | 'history'
type ViewMode = 'cards' | 'compact'

// 'default' keeps the server's alphabetical-by-ticker order.
const PRICE_SORT_LABELS: Record<PriceSort, string> = {
  default: 'A–Z',
  high: 'Price high → low',
  low: 'Price low → high',
}

// Source URLs come from third-party news data; never render a non-http(s)
// scheme (javascript:, data:) as a clickable link.
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

// While a full-screen layer (modal, side menu) is open, stop the page behind it
// from scrolling — otherwise touch-scrolling the layer also scrolls the page.
function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [locked])
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

// Three bars that morph into an X while the menu is open: outer bars rotate
// into the diagonals, the middle bar fades out.
function MenuToggleIcon({ open }: { open: boolean }) {
  const bar = 'absolute left-0 h-0.5 w-5 rounded bg-current transition-all duration-200 ease-out'
  return (
    <span className="relative block w-5 h-4" aria-hidden="true">
      <span className={`${bar} ${open ? 'top-[7px] rotate-45' : 'top-0'}`} />
      <span className={`${bar} top-[7px] ${open ? 'opacity-0' : 'opacity-100'}`} />
      <span className={`${bar} ${open ? 'top-[7px] -rotate-45' : 'top-[14px]'}`} />
    </span>
  )
}

function SlidersIcon() {
  // Drawn on a 16-unit grid and rendered at exactly 16px (w-4) so strokes land
  // on whole pixels — the previous 24-unit version scaled by 1.5× and blurred.
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M1 3.5h14M1 8h14M1 12.5h14" strokeLinecap="round" />
      <circle cx="5" cy="3.5" r="2.25" fill="currentColor" stroke="none" />
      <circle cx="11" cy="8" r="2.25" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12.5" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

function SideMenu({
  open,
  onClose,
  tab,
  onSelectTab,
  direction,
  onDirection,
  assetType,
  onAssetType,
  priceSort,
  onPriceSort,
  view,
  onView,
  countLabel,
}: {
  open: boolean
  onClose: () => void
  tab: Tab
  onSelectTab: (tab: Tab) => void
  direction: DirectionFilter
  onDirection: (d: DirectionFilter) => void
  assetType: AssetTypeFilter
  onAssetType: (t: AssetTypeFilter) => void
  priceSort: PriceSort
  onPriceSort: (s: PriceSort) => void
  view: ViewMode
  onView: (v: ViewMode) => void
  countLabel: string
}) {
  // Filters stay collapsed until Signals is pressed (pressing it again toggles),
  // so the nav items sit directly next to each other when the menu opens.
  const [filtersOpen, setFiltersOpen] = useState(false)
  useBodyScrollLock(open)

  const navItem = (active: boolean) =>
    `w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-between ${
      active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:bg-zinc-900'
    }`

  return (
    // Stays mounted so closing can animate (transitions can't run on unmount).
    // visibility transitions discretely: it flips to visible immediately on open
    // but only goes hidden after the 200ms close, keeping the slide-out on
    // screen and then dropping the closed drawer from the tab order / a11y tree.
    <div
      className={`fixed inset-0 z-[70] transition-[visibility] duration-200 ${
        open ? 'visible' : 'invisible pointer-events-none'
      }`}
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ease-out ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-72 max-w-[85vw] bg-zinc-950 border-l border-zinc-800 overflow-y-auto overscroll-contain p-4 space-y-1 transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        // Unmounting used to reset the filter accordion for free; now collapse it
        // once the slide-out finishes (not during — it would visibly scrunch),
        // so the menu still always reopens with filters closed.
        onTransitionEnd={e => {
          if (!open && e.target === e.currentTarget) setFiltersOpen(false)
        }}
        data-testid="side-menu"
      >
        {/* No close button here — the floating hamburger morphs into an X and stays on top. */}
        <div className="mb-2 py-1">
          <span className="text-sm font-semibold text-zinc-100">Menu</span>
        </div>

        <button
          onClick={() => {
            setFiltersOpen(tab === 'signals' ? !filtersOpen : true)
            onSelectTab('signals')
          }}
          data-testid="menu-signals"
          className={navItem(tab === 'signals')}
        >
          <span>Signals</span>
          {/* Downward chevron = "this expands"; History deliberately has none — it's just a page. */}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${filtersOpen && tab === 'signals' ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Always mounted so the grid-rows accordion can animate open/closed;
            it sits directly under Signals and pushes Past Signals down smoothly. */}
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            filtersOpen && tab === 'signals' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
          data-testid="menu-filters"
        >
          <div className="overflow-hidden">
            <div className="ml-2 pl-3 border-l border-zinc-800 py-2 space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
              <SlidersIcon />
              Filters
            </div>

            <div>
              <div className="text-xs text-zinc-600 mb-1.5">Direction</div>
              <div className="flex flex-wrap gap-1.5" data-testid="direction-filters">
                {(['all', 'buy', 'sell', 'hold'] as DirectionFilter[]).map(d => (
                  <FilterChip key={d} active={direction === d} onClick={() => onDirection(d)}>
                    {d === 'all' ? 'All' : d[0].toUpperCase() + d.slice(1)}
                  </FilterChip>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-600 mb-1.5">Asset type</div>
              <div className="flex flex-wrap gap-1.5" data-testid="type-filters">
                {(['all', 'index', 'commodity', 'equity', 'forex', 'crypto'] as AssetTypeFilter[]).map(t => (
                  <FilterChip key={t} active={assetType === t} onClick={() => onAssetType(t)}>
                    {t === 'all' ? 'All' : ASSET_TYPE_LABELS[t]}
                  </FilterChip>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-600 mb-1.5">Sort</div>
              <div className="flex flex-wrap gap-1.5" data-testid="price-sort">
                {(['default', 'high', 'low'] as PriceSort[]).map(s => (
                  <FilterChip key={s} active={priceSort === s} onClick={() => onPriceSort(s)}>
                    {PRICE_SORT_LABELS[s]}
                  </FilterChip>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-zinc-600 mb-1.5">View</div>
              <div className="flex flex-wrap gap-1.5" data-testid="view-toggle">
                {(['cards', 'compact'] as ViewMode[]).map(v => (
                  <FilterChip key={v} active={view === v} onClick={() => onView(v)}>
                    {v === 'cards' ? 'Cards' : 'Compact'}
                  </FilterChip>
                ))}
              </div>
            </div>

              <div className="text-xs text-zinc-600">{countLabel}</div>
            </div>
          </div>
        </div>

        <button
          onClick={() => onSelectTab('history')}
          data-testid="menu-history"
          className={navItem(tab === 'history')}
        >
          <span>Past Signals</span>
        </button>
      </aside>
    </div>
  )
}

// Reddit-style compact row: one line per asset, click still opens the full view.
function CompactRow({ data, onOpen }: { data: CardData; onOpen: () => void }) {
  const { asset, latest, price } = data
  const colors = latest ? directionColors(latest.direction) : null

  return (
    <button
      onClick={onOpen}
      data-testid={`asset-row-${asset.ticker}`}
      className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 flex items-center gap-3 transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
    >
      <span className="font-semibold text-zinc-100 w-20 shrink-0 truncate">{asset.ticker}</span>
      <span className="hidden sm:block text-xs text-zinc-500 truncate">{asset.name}</span>
      <span className="ml-auto flex items-center gap-3 shrink-0">
        {price != null && (
          <span className="text-sm text-zinc-300 tabular-nums">
            {asset.asset_type === 'forex' ? '' : '$'}{formatPrice(price)}
          </span>
        )}
        {latest && colors ? (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${colors.badge}`}>
            {latest.direction}
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-600">no signal</span>
        )}
        {latest && (
          <span className="text-xs text-zinc-500 w-9 text-right tabular-nums">{latest.confidence}%</span>
        )}
      </span>
    </button>
  )
}

// Minimal trading-app tile: ticker, price, direction, confidence — no prose.
// The reasoning, sources, and breakdown live in the detail view a click away.
function AssetCard({ data, onOpen }: { data: CardData; onOpen: () => void }) {
  const { asset, latest, price } = data
  const colors = latest ? directionColors(latest.direction) : null

  return (
    <button
      onClick={onOpen}
      data-testid={`asset-card-${asset.ticker}`}
      className="text-left rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 flex flex-col gap-2 transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-zinc-100">{asset.ticker}</div>
          <div className="text-xs text-zinc-500 truncate">{asset.name}</div>
        </div>
        {latest && colors ? (
          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${colors.badge}`}>
            {latest.direction}
          </span>
        ) : (
          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-600">—</span>
        )}
      </div>

      <div className="text-lg font-medium text-zinc-100 tabular-nums">
        {price != null ? `${asset.asset_type === 'forex' ? '' : '$'}${formatPrice(price)}` : '—'}
      </div>

      {latest ? (
        <div>
          <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
            <span>Confidence</span>
            <span>{latest.confidence}%</span>
          </div>
          {/* Bar takes the signal's direction color (user-requested 2026-07-11,
              superseding the earlier neutral-blue decision). */}
          <div className="h-1 rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full ${directionColors(latest.direction).dot}`}
              style={{ width: `${latest.confidence}%` }}
            />
          </div>
          <div className="text-right text-[10px] text-zinc-600 mt-1">{timeAgo(latest.created_at)}</div>
        </div>
      ) : (
        <div className="text-[10px] text-zinc-600 italic">no signal yet</div>
      )}
    </button>
  )
}

function AssetDetailModal({ data, onClose }: { data: CardData; onClose: () => void }) {
  const { asset, latest, accuracy, price } = data
  const colors = latest ? directionColors(latest.direction) : null
  useBodyScrollLock(true)

  return (
    <div
      // z-[60] keeps the modal above the fixed disclaimer banner (z-50), which used
      // to cover the bottom of the modal on phones; overscroll-contain plus the body
      // scroll lock stops scrolling from leaking to the page behind.
      className="fixed inset-0 z-[60] bg-black/70 flex items-start justify-center overflow-y-auto overscroll-contain p-4 md:p-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6 flex flex-col gap-4"
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

        {/* Trading-app layout: chart takes the left ~60% on desktop, the signal
            details sit alongside it; on mobile the columns stack. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-x-6 gap-y-4">
          <div className="lg:col-span-3 space-y-1.5">
            <TradingViewSingleQuote asset={asset} />
            <TradingViewChart asset={asset} />
            <div className="text-xs text-zinc-600">
              Live price &amp; chart: {tradingViewSymbol(asset)} (TradingView) — the instrument this asset&apos;s
              signals are quoted and graded against. The price in the header above is the Finnhub quote the app
              grades with, refreshed about once a minute; a small gap vs. the live stream is timing, not an error.
            </div>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-4">
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [assetType, setAssetType] = useState<AssetTypeFilter>('all')
  const [priceSort, setPriceSort] = useState<PriceSort>('default')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [livePrices, setLivePrices] = useState<Record<string, number | null> | null>(null)
  // Cards/Compact preference, persisted in localStorage. useSyncExternalStore
  // (rather than setState-in-effect) keeps hydration correct: the server render
  // uses 'cards', then React swaps in the stored value on the client.
  const view = useSyncExternalStore(
    onStoreChange => {
      window.addEventListener('ms-view-change', onStoreChange)
      return () => window.removeEventListener('ms-view-change', onStoreChange)
    },
    (): ViewMode => (window.localStorage.getItem('ms_view') === 'compact' ? 'compact' : 'cards'),
    (): ViewMode => 'cards'
  )

  const changeView = (v: ViewMode) => {
    window.localStorage.setItem('ms_view', v)
    window.dispatchEvent(new Event('ms-view-change'))
  }

  // Poll /api/quotes so card prices track the market while the page sits open,
  // instead of freezing at the page-load snapshot. Skips ticks while the tab is
  // hidden to spare the Finnhub quota.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const res = await fetch('/api/quotes')
        if (!res.ok) return
        const json: { prices?: Record<string, number | null> } = await res.json()
        if (!cancelled && json.prices) setLivePrices(json.prices)
      } catch {
        // transient network failure — just wait for the next tick
      }
    }
    const id = setInterval(tick, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const liveCards = useMemo(
    () =>
      livePrices
        ? cards.map(c => ({ ...c, price: livePrices[c.asset.id] ?? c.price }))
        : cards,
    [cards, livePrices]
  )

  const selected = selectedId ? liveCards.find(c => c.asset.id === selectedId) ?? null : null

  const q = query.trim().toLowerCase()
  const matchesText = (asset: WatchlistAsset) =>
    q === '' || asset.ticker.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q)

  const filtered = liveCards.filter(c => {
    if (direction !== 'all' && c.latest?.direction !== direction) return false
    if (assetType !== 'all' && c.asset.asset_type !== assetType) return false
    return matchesText(c.asset)
  })

  if (priceSort !== 'default') {
    filtered.sort((a, b) => {
      if (a.price == null && b.price == null) return 0
      if (a.price == null) return 1
      if (b.price == null) return -1
      return priceSort === 'high' ? b.price - a.price : a.price - b.price
    })
  }

  // The same menu filters drive the history tab: direction matches the signal's
  // call (not the actual outcome), type/search match the asset.
  const filteredOutcomes = outcomes.filter(o => {
    if (direction !== 'all' && o.signals.direction !== direction) return false
    if (assetType !== 'all' && o.signals.watchlist.asset_type !== assetType) return false
    return matchesText(o.signals.watchlist)
  })

  const countLabel =
    tab === 'signals'
      ? `${filtered.length} of ${liveCards.length} assets`
      : `${filteredOutcomes.length} of ${outcomes.length} checks`

  const filtersActive = direction !== 'all' || assetType !== 'all' || priceSort !== 'default'

  return (
    <div>
      <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-semibold text-zinc-100 tracking-tight">Market Signals</h1>
          <p className="text-xs text-zinc-500">Personal observation tool</p>
        </div>
        <div className="flex items-center gap-3">
          {latestRun && (
            <div className="hidden sm:block text-xs text-zinc-500 whitespace-nowrap">Updated {timeAgo(latestRun)}</div>
          )}
          <SearchBox
            cards={liveCards}
            query={query}
            onQueryChange={setQuery}
            onPick={card => { setSelectedId(card.asset.id); setQuery('') }}
          />
          {/* Spacer reserving room for the fixed menu toggle below. */}
          <div className="w-9 shrink-0" />
        </div>
      </header>

      {/* Fixed (not inside the header) so it stays above the open menu's backdrop
          and can morph into the X that closes it. The sticky header keeps this
          spot visually "in" the header at all times. Hidden while the detail
          modal is open: at z-[80] it would poke through the modal (z-[60]) and
          sit right on top of the modal's own ✕. */}
      {!selected && (
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          data-testid="menu-button"
          className="fixed right-4 sm:right-6 top-3.5 z-[80] p-2 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 transition-colors"
        >
          <MenuToggleIcon open={menuOpen} />
          {filtersActive && !menuOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
          )}
        </button>
      )}

      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        tab={tab}
        onSelectTab={t => {
          setTab(t)
          // History has no sub-options, so jump straight to it; Signals stays
          // open to reveal the filter section underneath.
          if (t === 'history') setMenuOpen(false)
        }}
        direction={direction}
        onDirection={setDirection}
        assetType={assetType}
        onAssetType={setAssetType}
        priceSort={priceSort}
        onPriceSort={setPriceSort}
        view={view}
        onView={changeView}
        countLabel={countLabel}
      />

      <div className="mx-auto max-w-6xl px-4 pt-5 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wide">
          {tab === 'signals' ? 'Signals' : 'Past Signals'}
        </h2>
        <span className="text-xs text-zinc-600">{countLabel}</span>
      </div>

      {tab === 'signals' ? (
        view === 'compact' ? (
          <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col gap-1.5">
            {filtered.map(data => (
              <CompactRow key={data.asset.id} data={data} onOpen={() => setSelectedId(data.asset.id)} />
            ))}
            {filtered.length === 0 && (
              <div className="text-center text-sm text-zinc-600 py-10">No assets match these filters.</div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-6xl px-4 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map(data => (
              <AssetCard key={data.asset.id} data={data} onOpen={() => setSelectedId(data.asset.id)} />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full text-center text-sm text-zinc-600 py-10">
                No assets match these filters.
              </div>
            )}
          </div>
        )
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-4">
          <HistoryList
            outcomes={filteredOutcomes}
            pendingCount={pendingCount}
            lastCheckedAt={outcomes[0]?.checked_at}
            capped={outcomesCapped}
            onOpenAsset={setSelectedId}
          />
        </div>
      )}

      {selected && <AssetDetailModal data={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
