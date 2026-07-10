import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardCronRequest } from '@/lib/apiAuth'
import type { CalibrationProfile, Signal, SignalDirection, WatchlistAsset } from '@/types'
import { bucketFor } from '@/lib/scoring/confidence'
import { getQuote } from '@/lib/finnhub/quote'
import { DECAY_PER_PERIOD, DECAY_PERIOD_DAYS, OUTCOME_GRADING_AGE_DAYS, OUTCOME_THRESHOLDS } from '@/lib/scoring/constants'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface GradeCandidate extends Signal {
  watchlist: WatchlistAsset
  // signal_outcomes.signal_id is UNIQUE, so PostgREST embeds this one-to-one:
  // a single object once graded, null before — not an array.
  signal_outcomes: { id: string } | { id: string }[] | null
}

interface GradedOutcome {
  asset_id: string
  direction: SignalDirection
  confidence: number
  was_correct: boolean
}

export async function GET(request: NextRequest) {
  const denied = guardCronRequest(request)
  if (denied) return denied

  const db = adminDb()
  const cutoff = new Date(Date.now() - OUTCOME_GRADING_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // ─── 1. Grade signals that have matured past the outcome window ─────────────

  const { data: candidates, error: fetchError } = await db
    .from('signals')
    .select('*, watchlist(*), signal_outcomes(id)')
    .lte('created_at', cutoff)
    .not('price_at_signal', 'is', null)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  // Tolerate both embed shapes (object/null for one-to-one, array if the unique
  // constraint is ever dropped) — .length on the null case crashed every run
  // from 2026-07-07 until this guard was added.
  const ungraded = ((candidates ?? []) as unknown as GradeCandidate[]).filter(
    s =>
      s.signal_outcomes == null ||
      (Array.isArray(s.signal_outcomes) && s.signal_outcomes.length === 0)
  )

  const graded: GradedOutcome[] = []

  for (const signal of ungraded) {
    const price = await getQuote(signal.watchlist.price_symbol)
    if (price == null || signal.price_at_signal == null) continue

    const pctChange = ((price - signal.price_at_signal) / signal.price_at_signal) * 100
    const threshold = OUTCOME_THRESHOLDS[signal.watchlist.asset_type]
    const actualDirection: SignalDirection =
      pctChange >= threshold ? 'buy' : pctChange <= -threshold ? 'sell' : 'hold'
    const wasCorrect = actualDirection === signal.direction

    const { error: insertError } = await db.from('signal_outcomes').insert({
      signal_id: signal.id,
      price_at_check: price,
      pct_change: pctChange,
      actual_direction: actualDirection,
      was_correct: wasCorrect,
    })

    if (!insertError) {
      graded.push({
        asset_id: signal.asset_id,
        direction: signal.direction,
        confidence: signal.confidence,
        was_correct: wasCorrect,
      })
    }

    // Finnhub free tier allows ~60 calls/min
    await sleep(1100)
  }

  // ─── 2. Roll graded outcomes into decayed, long-memory calibration profiles ──

  const groups = new Map<string, GradedOutcome[]>()
  for (const g of graded) {
    const key = `${g.asset_id}|${g.direction}|${bucketFor(g.confidence)}`
    const list = groups.get(key) ?? []
    list.push(g)
    groups.set(key, list)
  }

  let bucketsUpdated = 0

  for (const [key, group] of groups) {
    const [asset_id, direction, confidence_bucket] = key.split('|')
    const batchCorrect = group.filter(g => g.was_correct).length
    const batchTotal = group.length

    const { data: existing } = await db
      .from('calibration_profiles')
      .select('*')
      .eq('asset_id', asset_id)
      .eq('direction', direction)
      .eq('confidence_bucket', confidence_bucket)
      .maybeSingle<CalibrationProfile>()

    // Decay is scaled by actual elapsed time, not by how often this route happens to run —
    // it's polled daily, but the calibration memory is designed around a ~5-day half-life
    // period, so a flat per-invocation decay would forget far faster than intended.
    const daysElapsed = existing
      ? (Date.now() - new Date(existing.last_updated).getTime()) / (24 * 60 * 60 * 1000)
      : 0
    const decayFactor = DECAY_PER_PERIOD ** (daysElapsed / DECAY_PERIOD_DAYS)

    const correct_count = (existing?.correct_count ?? 0) * decayFactor + batchCorrect
    const total_count = (existing?.total_count ?? 0) * decayFactor + batchTotal

    const { error: upsertError } = await db.from('calibration_profiles').upsert(
      {
        asset_id,
        direction,
        confidence_bucket,
        correct_count,
        total_count,
        last_updated: new Date().toISOString(),
      },
      { onConflict: 'asset_id,direction,confidence_bucket' }
    )

    if (!upsertError) bucketsUpdated += 1
  }

  return NextResponse.json({
    graded: graded.length,
    candidates_considered: ungraded.length,
    buckets_updated: bucketsUpdated,
  })
}
