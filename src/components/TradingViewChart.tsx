'use client'

import { useEffect, useRef } from 'react'
import type { WatchlistAsset } from '@/types'

// The chart deliberately shows the same instrument the app quotes and grades against
// (price_symbol), so what you see is exactly the series signals are scored on —
// not e.g. spot gold in $/oz while the card shows GLD in $/share.
export function tradingViewSymbol(asset: WatchlistAsset): string {
  if (asset.asset_type === 'forex') {
    // Finnhub 'OANDA:EUR_USD' → TradingView 'OANDA:EURUSD'
    return asset.price_symbol.replace('_', '')
  }
  // Exchange-prefixed symbols (crypto) pass through; bare US tickers/ETFs
  // resolve on TradingView as-is.
  return asset.price_symbol
}

export default function TradingViewChart({ asset }: { asset: WatchlistAsset }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tradingViewSymbol(asset),
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      support_host: 'https://www.tradingview.com',
    })
    container.appendChild(script)

    return () => {
      container.replaceChildren()
    }
  }, [asset])

  return (
    <div className="rounded-lg overflow-hidden border border-zinc-800" style={{ height: 380 }}>
      <div ref={containerRef} className="tradingview-widget-container h-full" />
    </div>
  )
}
