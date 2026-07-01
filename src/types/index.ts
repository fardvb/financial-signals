export type AssetType = 'index' | 'commodity' | 'equity' | 'forex'
export type CommodityCategory = 'safe-haven' | 'industrial' | 'energy'
export type SignalDirection = 'buy' | 'sell' | 'hold'

export interface WatchlistAsset {
  id: string
  ticker: string
  name: string
  asset_type: AssetType
  commodity_category: CommodityCategory | null
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
  created_at: string
}

export interface SignalWithAsset extends Signal {
  watchlist: WatchlistAsset
}
