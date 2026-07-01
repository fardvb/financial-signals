import { createAdminClient } from '@/lib/supabase/admin'
import type { WatchlistAsset, Signal, SignalDirection, SignalSource } from '@/types'

export const dynamic = 'force-dynamic'

interface SignalRow extends Signal {
  watchlist: WatchlistAsset
}

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function directionColors(d: SignalDirection) {
  if (d === 'buy') return { badge: 'bg-emerald-900 text-emerald-300', bar: 'bg-emerald-500', dot: 'bg-emerald-500' }
  if (d === 'sell') return { badge: 'bg-red-900 text-red-300', bar: 'bg-red-500', dot: 'bg-red-500' }
  return { badge: 'bg-zinc-800 text-zinc-300', bar: 'bg-zinc-500', dot: 'bg-zinc-500' }
}

function assetTypeBadge(asset: WatchlistAsset): string {
  if (asset.commodity_category === 'safe-haven') return 'Safe Haven'
  if (asset.commodity_category === 'industrial') return 'Industrial'
  if (asset.commodity_category === 'energy') return 'Energy'
  if (asset.asset_type === 'index') return 'Index'
  if (asset.asset_type === 'forex') return 'Forex'
  return 'Equity'
}

function AssetCard({ asset, latest, history }: {
  asset: WatchlistAsset
  latest: SignalRow | undefined
  history: SignalRow[]
}) {
  const colors = latest ? directionColors(latest.direction) : null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100">{asset.ticker}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {assetTypeBadge(asset)}
            </span>
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
              <div
                className={`h-full rounded-full ${colors!.bar}`}
                style={{ width: `${latest.confidence}%` }}
              />
            </div>
          </div>

          <p className="text-sm text-zinc-300 leading-relaxed">{latest.reasoning}</p>

          {latest.sources.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-zinc-500 uppercase tracking-wide">Sources</div>
              {(latest.sources as SignalSource[]).slice(0, 3).map((s, i) => (
                <div key={i} className="text-xs text-zinc-400 leading-snug">
                  <span className="text-zinc-500">{s.source} · </span>
                  {s.headline}
                </div>
              ))}
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
    </div>
  )
}

export default async function DashboardPage() {
  const db = createAdminClient()

  const [{ data: assets }, { data: signals }] = await Promise.all([
    db.from('watchlist').select('*').eq('active', true).order('asset_type').order('ticker'),
    db.from('signals').select('*, watchlist(*)').order('created_at', { ascending: false }).limit(120),
  ])

  const watchlist = (assets ?? []) as WatchlistAsset[]
  const signalRows = (signals ?? []) as SignalRow[]

  const byAsset: Record<string, SignalRow[]> = {}
  for (const s of signalRows) {
    if (!byAsset[s.asset_id]) byAsset[s.asset_id] = []
    if (byAsset[s.asset_id].length < 5) byAsset[s.asset_id].push(s)
  }

  const latestRun = signalRows[0]?.created_at

  return (
    <main className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-zinc-100 tracking-tight">Market Signals</h1>
          <p className="text-xs text-zinc-500">Personal observation tool</p>
        </div>
        {latestRun && (
          <div className="text-xs text-zinc-500">Updated {timeAgo(latestRun)}</div>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {watchlist.map(asset => (
          <AssetCard
            key={asset.id}
            asset={asset}
            latest={byAsset[asset.id]?.[0]}
            history={byAsset[asset.id] ?? []}
          />
        ))}
      </div>
    </main>
  )
}
