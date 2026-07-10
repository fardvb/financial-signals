import type { AssetClass, WatchlistAsset } from '@/types'

const DEFENSE_TICKERS = new Set(['LMT', 'RTX'])

export function getAssetClass(asset: WatchlistAsset): AssetClass {
  if (asset.commodity_category === 'safe-haven') return 'safe-haven'
  if (asset.commodity_category === 'industrial') return 'industrial-metal'
  if (asset.commodity_category === 'energy') return 'energy'
  if (asset.asset_type === 'index') return 'broad-index'
  if (asset.asset_type === 'forex') return 'forex'
  if (asset.asset_type === 'crypto') return 'crypto'
  return DEFENSE_TICKERS.has(asset.ticker) ? 'defense-equity' : 'general-equity'
}
