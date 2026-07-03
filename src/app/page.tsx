import { createAdminClient } from '@/lib/supabase/admin'
import type { WatchlistAsset, Signal, CalibrationProfile } from '@/types'
import { MIN_N_FOR_DASHBOARD_DISPLAY } from '@/lib/scoring/constants'
import { getQuote } from '@/lib/finnhub/quote'
import AssetGrid, { type CardData } from '@/components/AssetGrid'

export const dynamic = 'force-dynamic'

export interface SignalRow extends Signal {
  watchlist: WatchlistAsset
}

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default async function DashboardPage() {
  const db = createAdminClient()

  const [{ data: assets }, { data: signals }, { data: calibration }] = await Promise.all([
    db.from('watchlist').select('*').eq('active', true).order('asset_type').order('ticker'),
    db.from('signals').select('*, watchlist(*)').order('created_at', { ascending: false }).limit(120),
    db.from('calibration_profiles').select('*'),
  ])

  const watchlist = (assets ?? []) as WatchlistAsset[]
  const signalRows = (signals ?? []) as SignalRow[]
  const calibrationRows = (calibration ?? []) as CalibrationProfile[]

  const quotes = await Promise.all(watchlist.map(asset => getQuote(asset.price_symbol)))
  const priceByAsset: Record<string, number | null> = {}
  watchlist.forEach((asset, i) => { priceByAsset[asset.id] = quotes[i] })

  const byAsset: Record<string, SignalRow[]> = {}
  for (const s of signalRows) {
    if (!byAsset[s.asset_id]) byAsset[s.asset_id] = []
    if (byAsset[s.asset_id].length < 5) byAsset[s.asset_id].push(s)
  }

  const accuracyByAsset: Record<string, { rate: number; n: number } | null> = {}
  for (const asset of watchlist) {
    const profiles = calibrationRows.filter(p => p.asset_id === asset.id)
    const n = profiles.reduce((sum, p) => sum + p.total_count, 0)
    const correct = profiles.reduce((sum, p) => sum + p.correct_count, 0)
    accuracyByAsset[asset.id] = n >= MIN_N_FOR_DASHBOARD_DISPLAY ? { rate: correct / n, n } : null
  }

  const latestRun = signalRows[0]?.created_at

  const cards: CardData[] = watchlist.map(asset => ({
    asset,
    latest: byAsset[asset.id]?.[0],
    history: byAsset[asset.id] ?? [],
    accuracy: accuracyByAsset[asset.id],
    price: priceByAsset[asset.id],
  }))

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

      <AssetGrid cards={cards} />
    </main>
  )
}
