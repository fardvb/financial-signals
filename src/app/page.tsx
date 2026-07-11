import { createAdminClient } from '@/lib/supabase/admin'
import type { WatchlistAsset, Signal, CalibrationProfile, OutcomeWithSignal } from '@/types'
import { MIN_N_FOR_DASHBOARD_DISPLAY, outcomeGradeCutoffISO } from '@/lib/scoring/constants'
import { getQuote } from '@/lib/finnhub/quote'
import AssetGrid, { type CardData } from '@/components/AssetGrid'

export const dynamic = 'force-dynamic'

export interface SignalRow extends Signal {
  watchlist: WatchlistAsset
}

// The history tab shows at most this many recent graded checks.
const OUTCOME_HISTORY_LIMIT = 200

export default async function DashboardPage() {
  const db = createAdminClient()

  const gradeCutoff = outcomeGradeCutoffISO()

  const [{ data: assets }, { data: signals }, { data: calibration }, { data: outcomes }, { count: pendingCount }] =
    await Promise.all([
      db.from('watchlist').select('*').eq('active', true).order('asset_type').order('ticker'),
      db.from('signals').select('*, watchlist(*)').order('created_at', { ascending: false }).limit(120),
      db.from('calibration_profiles').select('*'),
      db
        .from('signal_outcomes')
        .select('*, signals(*, watchlist(*))')
        .order('checked_at', { ascending: false })
        .limit(OUTCOME_HISTORY_LIMIT),
      // Signals still too young to grade — the history tab's "waiting to be checked" count.
      db
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', gradeCutoff)
        .not('price_at_signal', 'is', null),
    ])

  const watchlist = (assets ?? []) as WatchlistAsset[]
  const signalRows = (signals ?? []) as SignalRow[]
  const calibrationRows = (calibration ?? []) as CalibrationProfile[]
  const outcomeRows = ((outcomes ?? []) as unknown as OutcomeWithSignal[]).filter(o => o.signals?.watchlist)

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
      <AssetGrid
        cards={cards}
        outcomes={outcomeRows}
        pendingCount={pendingCount ?? 0}
        outcomesCapped={outcomeRows.length >= OUTCOME_HISTORY_LIMIT}
        latestRun={latestRun}
      />
    </main>
  )
}
