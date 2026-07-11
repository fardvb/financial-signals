import type { AssetType } from '@/types'

export const WEIGHTS = { llm: 0.4, source: 0.25, event: 0.35 }

export const CREDIBLE_SOURCES = new Set([
  'Reuters',
  'Bloomberg',
  'Associated Press',
  'AP',
  'Wall Street Journal',
  'WSJ',
])

export const CALIB_MAX_PULL = 0.6
export const N_SATURATE = 12
export const MIN_N_FOR_CALIB_PULL = 2
export const MIN_N_FOR_PROMPT_CONTEXT = 3
export const MIN_N_FOR_DASHBOARD_DISPLAY = 5

export const OUTCOME_THRESHOLDS: Record<AssetType, number> = {
  index: 1.5,
  equity: 2.0,
  commodity: 2.0,
  forex: 0.75,
  // BTC routinely moves ±2% on noise alone; a wider band keeps 'hold' meaningful.
  crypto: 3.0,
}

export const CONFIDENCE_BUCKETS = [
  { key: 'low', min: 0, max: 39 },
  { key: 'moderate', min: 40, max: 59 },
  { key: 'high', min: 60, max: 79 },
  { key: 'very_high', min: 80, max: 100 },
] as const

// Calibration decay is time-scaled (see src/app/api/calibrate/route.ts), not applied
// flatly per cron invocation — DECAY_PER_PERIOD is the decay factor per DECAY_PERIOD_DAYS
// of elapsed real time, so it stays correct regardless of how often the job actually runs.
export const DECAY_PER_PERIOD = 0.9
export const DECAY_PERIOD_DAYS = 5

// Signals younger than this are considered still-fresh for the dedup guard in /api/ingest.
export const DEDUP_WINDOW_HOURS = 6

// Signals must be at least this many days old before /api/calibrate will grade them.
export const OUTCOME_GRADING_AGE_DAYS = 5

// ISO timestamp of the oldest creation time that is still too young to grade —
// signals created after this are "waiting to be checked".
export function outcomeGradeCutoffISO(): string {
  return new Date(Date.now() - OUTCOME_GRADING_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
}
