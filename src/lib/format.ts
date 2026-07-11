import type { AssetType, SignalDirection } from '@/types'

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  index: 'Index',
  commodity: 'Commodity',
  equity: 'Equity',
  forex: 'Forex',
  crypto: 'Crypto',
}

export function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function directionColors(d: SignalDirection) {
  if (d === 'buy') return { badge: 'bg-emerald-900 text-emerald-300', dot: 'bg-emerald-500' }
  if (d === 'sell') return { badge: 'bg-red-900 text-red-300', dot: 'bg-red-500' }
  return { badge: 'bg-zinc-800 text-zinc-300', dot: 'bg-zinc-500' }
}

export function formatPrice(price: number): string {
  const decimals = price < 10 ? 4 : 2
  return price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
