export type AssetType = 'index' | 'commodity' | 'equity' | 'forex'
export type CommodityCategory = 'safe-haven' | 'industrial' | 'energy'
export type SignalDirection = 'buy' | 'sell' | 'hold'

export type EventCategory =
  | 'geopolitical-conflict'
  | 'currency-crisis'
  | 'central-bank-policy'
  | 'sanctions'
  | 'supply-disruption'
  | 'corporate-earnings'
  | 'regulatory'
  | 'analyst-rating'
  | 'routine-macro'
  | 'other'

export type AssetClass =
  | 'safe-haven'
  | 'industrial-metal'
  | 'energy'
  | 'broad-index'
  | 'forex'
  | 'defense-equity'
  | 'general-equity'

export type ConfidenceBucket = 'low' | 'moderate' | 'high' | 'very_high'

export interface WatchlistAsset {
  id: string
  ticker: string
  name: string
  asset_type: AssetType
  commodity_category: CommodityCategory | null
  price_symbol: string
  active: boolean
  created_at: string
}

export interface SignalSource {
  headline: string
  source: string
  published_at: string
}

export interface Signal {
  id: string
  asset_id: string
  direction: SignalDirection
  confidence: number
  reasoning: string
  sources: SignalSource[]
  news_window_start: string
  price_at_signal: number | null
  created_at: string
}

export interface SignalWithAsset extends Signal {
  watchlist: WatchlistAsset
}

export interface SignalOutcome {
  id: string
  signal_id: string
  price_at_check: number
  pct_change: number
  actual_direction: SignalDirection
  was_correct: boolean
  checked_at: string
}

export interface CalibrationProfile {
  id: string
  asset_id: string
  direction: SignalDirection
  confidence_bucket: ConfidenceBucket
  correct_count: number
  total_count: number
  last_updated: string
}
