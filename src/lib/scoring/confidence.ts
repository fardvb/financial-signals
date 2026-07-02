import type { AssetClass, ConfidenceBucket, EventCategory, SignalDirection } from '@/types'
import { EVENT_WEIGHTS } from './eventWeights'
import { CALIB_MAX_PULL, CONFIDENCE_BUCKETS, CREDIBLE_SOURCES, MIN_N_FOR_CALIB_PULL, N_SATURATE, WEIGHTS } from './constants'

export interface TriagedArticle {
  source: string
  category: EventCategory
}

export interface CalibrationSnapshot {
  correctCount: number
  totalCount: number
}

export interface ConfidenceInputs {
  llmConfidence: number
  triaged: TriagedArticle[]
  assetClass: AssetClass
  direction: SignalDirection
  // Keyed by confidence bucket, since which bucket's calibration record applies
  // isn't known until after the blended (pre-calibration) score is computed.
  calibrationByBucket: Partial<Record<ConfidenceBucket, CalibrationSnapshot>>
}

export function bucketFor(confidence: number): ConfidenceBucket {
  const bucket = CONFIDENCE_BUCKETS.find(b => confidence >= b.min && confidence <= b.max)
  return (bucket ?? CONFIDENCE_BUCKETS[CONFIDENCE_BUCKETS.length - 1]).key
}

function sourceCorroborationScore(triaged: TriagedArticle[]): number {
  const distinctSources = new Set(triaged.map(a => a.source))
  let weightedCount = 0
  for (const source of distinctSources) {
    weightedCount += CREDIBLE_SOURCES.has(source) ? 1.5 : 1
  }
  return 100 * (1 - Math.exp(-0.5 * weightedCount))
}

function eventMagnitudeScore(triaged: TriagedArticle[], assetClass: AssetClass): number {
  if (triaged.length === 0) return 0
  const categories = new Set(triaged.map(a => a.category))
  let maxWeight = 0
  for (const category of categories) {
    maxWeight = Math.max(maxWeight, EVENT_WEIGHTS[category][assetClass])
  }
  return 100 * maxWeight
}

function applyCalibrationPull(
  blended: number,
  calibrationByBucket: Partial<Record<ConfidenceBucket, CalibrationSnapshot>>
): number {
  const snapshot = calibrationByBucket[bucketFor(blended)]
  if (!snapshot || snapshot.totalCount < MIN_N_FOR_CALIB_PULL) return blended

  const hitRate = snapshot.correctCount / snapshot.totalCount
  const calibTrust = Math.min(1, snapshot.totalCount / N_SATURATE)
  const pull = calibTrust * CALIB_MAX_PULL

  return blended * (1 - pull) + hitRate * 100 * pull
}

export function computeConfidence(inputs: ConfidenceInputs): number {
  const srcScore = sourceCorroborationScore(inputs.triaged)
  const eventScore = eventMagnitudeScore(inputs.triaged, inputs.assetClass)

  const blended =
    WEIGHTS.llm * inputs.llmConfidence +
    WEIGHTS.source * srcScore +
    WEIGHTS.event * eventScore

  const final = applyCalibrationPull(blended, inputs.calibrationByBucket)
  return Math.round(Math.max(0, Math.min(100, final)))
}
