'use client'

import { useState } from 'react'
import type { AssetType, SignalDirection, SignalSource, WatchlistAsset } from '@/types'
import type { SignalRow } from '@/app/page'

export interface CardData {
  asset: WatchlistAsset
  latest: SignalRow | undefined
  history: SignalRow[]
  accuracy: { rate: number; n: number } | null
  price: number | null
}

type DirectionFilter = 'all' | SignalDirection
type AssetTypeFilter = 'all' | AssetType

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  index: 'Index',
  commodity: 'Commodity',
  equity: 'Equity',
  forex: 'Forex',
}

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function directionColors(d: SignalDirection) {
  if (d === 'buy') return { badge: 'bg-emerald-900 text-emerald-300', dot: 'bg-emerald-500' }
  if (d === 'sell') return { badge: 'bg-red-900 text-red-300', dot: 'bg-red-500' }
  return { badge: 'bg-zinc-800 text-zinc-300', dot: 'bg-zinc-500' }
}

function formatPrice(price: number): string {
  const decimals = price < 10 ? 4 : 2
  return price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function assetTypeBadge(asset: WatchlistAsset): string {
  if (asset.commodity_category === 'safe-haven') return 'Safe Haven'
  if (asset.commodity_category === 'industrial') return 'Industrial'
  if (asset.commodity_category === 'energy') return 'Energy'
  if (asset.asset_type === 'index') return 'Index'
  if (asset.asset_type === 'forex') return 'Forex'
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

function PriceLine({ asset, price }: { asset: WatchlistAsset; price: number | null }) {
  if (price == null) return null
  return (
    <span className="text-sm text-zinc-300 tabular-nums">
      {asset.asset_type === 'forex' ? '' : '$'}{formatPrice(price)}
      <span className="text-zinc-500">{asset.asset_type === 'forex' ? ' $/lot' : ' $/share'}</span>
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
  const { asset, latest, history, accuracy, price } = data
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
                  s.url ? (
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

            {history.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-zinc-800">
                <div className="text-xs text-zinc-500 uppercase tracking-wide">Recent history</div>
                {history.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${directionColors(s.direction).dot}`} />
                      {s.direction} · {s.confidence}%
                    </span>
                    <span className="text-zinc-600">{new Date(s.created_at).toLocaleString()}</span>
                  </div>
                ))}
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

export default function AssetGrid({ cards }: { cards: CardData[] }) {
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [assetType, setAssetType] = useState<AssetTypeFilter>('all')
  const [selected, setSelected] = useState<CardData | null>(null)

  const filtered = cards.filter(c => {
    if (direction !== 'all' && c.latest?.direction !== direction) return false
    if (assetType !== 'all' && c.asset.asset_type !== assetType) return false
    return true
  })

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
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
          {(['all', 'index', 'commodity', 'equity', 'forex'] as AssetTypeFilter[]).map(t => (
            <FilterChip key={t} active={assetType === t} onClick={() => setAssetType(t)}>
              {t === 'all' ? 'All' : ASSET_TYPE_LABELS[t]}
            </FilterChip>
          ))}
        </div>
        <span className="text-xs text-zinc-600">{filtered.length} of {cards.length}</span>
      </div>

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

      {selected && <AssetDetailModal data={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
