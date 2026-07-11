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

// Every TradingView embed works the same way: a script tag whose body is the
// widget's config JSON, injected into a container div.
function injectWidget(container: HTMLElement, scriptFile: string, config: Record<string, unknown>) {
  const script = document.createElement('script')
  script.src = `https://s3.tradingview.com/external-embedding/${scriptFile}`
  script.async = true
  script.innerHTML = JSON.stringify(config)
  container.appendChild(script)
}

export default function TradingViewChart({ asset }: { asset: WatchlistAsset }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    injectWidget(container, 'embed-widget-advanced-chart.js', {
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

// Live streaming price from TradingView — the same feed the chart renders, so this
// number always matches the chart (unlike the page-load Finnhub snapshot, which can
// drift a fraction of a percent while the page sits open).
export function TradingViewSingleQuote({ asset }: { asset: WatchlistAsset }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    injectWidget(container, 'embed-widget-single-quote.js', {
      symbol: tradingViewSymbol(asset),
      width: '100%',
      colorTheme: 'dark',
      isTransparent: true,
      locale: 'en',
    })

    return () => {
      container.replaceChildren()
    }
  }, [asset])

  return <div ref={containerRef} className="tradingview-widget-container" data-testid="tv-single-quote" />
}
