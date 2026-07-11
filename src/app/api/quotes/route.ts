import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getQuote } from '@/lib/finnhub/quote'
import type { WatchlistAsset } from '@/types'

export const dynamic = 'force-dynamic'

// Live prices for the dashboard's client-side refresh. Public market data only,
// so no auth — the CDN cache (s-maxage) is what protects the Finnhub quota:
// however many browsers poll, the upstream fetch happens at most ~once per
// cache window per region (24 symbols ≈ 24 Finnhub calls, budget is 60/min).
export async function GET() {
  const db = createAdminClient()
  const { data: assets, error } = await db
    .from('watchlist')
    .select('id, price_symbol')
    .eq('active', true)

  if (error) {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }

  const list = (assets ?? []) as Pick<WatchlistAsset, 'id' | 'price_symbol'>[]
  const quotes = await Promise.all(list.map(a => getQuote(a.price_symbol)))

  const prices: Record<string, number | null> = {}
  list.forEach((a, i) => { prices[a.id] = quotes[i] })

  return NextResponse.json(
    { prices, at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=60' } }
  )
}
