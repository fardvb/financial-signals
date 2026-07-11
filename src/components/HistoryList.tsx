'use client'

// Past Signals tab body: one row per graded 5-day check (✓/✗, called vs actual
// direction, price move), a time-range picker (today/week/month/year so the list
// doesn't grow forever), a stats strip, and the grading formula rendered from
// the same constants /api/calibrate actually grades with — so the explanation
// can never drift from the real behavior.
import { useState } from 'react'
import type { AssetType, OutcomeWithSignal } from '@/types'
import { OUTCOME_GRADING_AGE_DAYS, OUTCOME_THRESHOLDS } from '@/lib/scoring/constants'
import FilterChip from '@/components/FilterChip'
import { ASSET_TYPE_LABELS, directionColors, formatPrice, timeAgo, withinDays } from '@/lib/format'

type HistoryRange = 'day' | 'week' | 'month' | 'year'

const RANGE_LABELS: Record<HistoryRange, string> = {
  day: 'Today',
  week: 'Week',
  month: 'Month',
  year: 'Year',
}

const RANGE_DAYS: Record<HistoryRange, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
}

function fmtDay(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-base font-semibold text-zinc-100 tabular-nums">{value}</div>
    </div>
  )
}

function OutcomeRow({ outcome, onOpen }: { outcome: OutcomeWithSignal; onOpen: () => void }) {
  const signal = outcome.signals
  const asset = signal.watchlist
  const called = directionColors(signal.direction)
  const actual = directionColors(outcome.actual_direction)
  const pct = outcome.pct_change
  const pctColor = pct > 0 ? 'text-emerald-400' : pct < 0 ? 'text-red-400' : 'text-zinc-400'

  return (
    <button
      onClick={onOpen}
      data-testid={`history-row-${asset.ticker}`}
      className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
    >
      <span
        aria-label={outcome.was_correct ? 'correct' : 'incorrect'}
        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
          outcome.was_correct ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'
        }`}
      >
        {outcome.was_correct ? '✓' : '✗'}
      </span>

      <div className="w-36 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-100">{asset.ticker}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
            {ASSET_TYPE_LABELS[asset.asset_type]}
          </span>
        </div>
        <div className="text-xs text-zinc-500 truncate">{asset.name}</div>
      </div>

      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${called.badge}`}>
          {signal.direction}
        </span>
        <span className="text-xs text-zinc-500">{signal.confidence}%</span>
      </div>

      <div className="text-xs text-zinc-500 whitespace-nowrap">
        {fmtDay(signal.created_at)} → {fmtDay(outcome.checked_at)}
      </div>

      <div className="text-sm text-zinc-300 tabular-nums whitespace-nowrap">
        {signal.price_at_signal != null ? formatPrice(signal.price_at_signal) : '—'} → {formatPrice(outcome.price_at_check)}
      </div>

      <div className={`text-sm font-medium tabular-nums ${pctColor}`}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <span className="text-xs text-zinc-500">actual</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${actual.badge}`}>
          {outcome.actual_direction}
        </span>
      </div>
    </button>
  )
}

export default function HistoryList({
  outcomes,
  pendingCount,
  lastCheckedAt,
  capped,
  onOpenAsset,
}: {
  outcomes: OutcomeWithSignal[]
  pendingCount: number
  lastCheckedAt?: string
  capped: boolean
  onOpenAsset: (assetId: string) => void
}) {
  // Checks land once a day, so "Today" keeps the default view short; the wider
  // ranges are there for looking back without the list scrolling forever.
  const [range, setRange] = useState<HistoryRange>('day')
  const inRange = outcomes.filter(o => withinDays(o.checked_at, RANGE_DAYS[range]))

  const correct = inRange.filter(o => o.was_correct).length
  const rate = inRange.length > 0 ? Math.round((correct / inRange.length) * 100) : null

  const thresholds = (Object.entries(OUTCOME_THRESHOLDS) as [AssetType, number][])
    .map(([type, pct]) => `${ASSET_TYPE_LABELS[type]} ±${pct}%`)
    .join(' · ')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5" data-testid="history-range">
        <span className="text-xs text-zinc-600 mr-1">Showing</span>
        {(['day', 'week', 'month', 'year'] as HistoryRange[]).map(r => (
          <FilterChip key={r} active={range === r} onClick={() => setRange(r)}>
            {RANGE_LABELS[r]}
          </FilterChip>
        ))}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
        data-testid="history-stats"
      >
        <Stat label="Graded checks" value={String(inRange.length)} />
        <Stat label="Correct" value={rate != null ? `${correct} · ${rate}%` : '—'} />
        <Stat label="Last check" value={lastCheckedAt ? timeAgo(lastCheckedAt) : '—'} />
        <Stat label="Waiting to be checked" value={String(pendingCount)} />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400 leading-relaxed">
        <span className="text-zinc-200 font-medium">How a check works: </span>
        {OUTCOME_GRADING_AGE_DAYS} days after a signal is created, the daily grading run measures the price move
        since the signal and compares it to the asset&apos;s threshold — up by at least the threshold counts as an
        actual &ldquo;buy&rdquo; move, down by at least the threshold as &ldquo;sell&rdquo;, anything smaller as
        &ldquo;hold&rdquo;. The signal gets a ✓ when its call matches what actually happened. Thresholds: {thresholds}.
      </div>

      <div className="space-y-2" data-testid="history-list">
        {inRange.map(o => (
          <OutcomeRow key={o.id} outcome={o} onOpen={() => onOpenAsset(o.signals.watchlist.id)} />
        ))}
        {inRange.length === 0 && (
          <div className="text-center text-sm text-zinc-600 py-10">
            {range === 'day'
              ? 'No checks today — grading runs once a day. Try Week or Month to look further back.'
              : `No graded signals in this window match the filters — signals are checked once they're ${OUTCOME_GRADING_AGE_DAYS} days old.`}
          </div>
        )}
      </div>

      {capped && (
        <div className="text-xs text-zinc-600">Showing the most recent checks only.</div>
      )}
    </div>
  )
}
