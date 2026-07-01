import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { WatchlistAsset, SignalDirection, SignalSource } from '@/types'

// Allow up to 5 minutes on Vercel — 12 assets × LLM calls takes time
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const anthropic = new Anthropic()

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Finnhub ─────────────────────────────────────────────────────────────────

interface FinnhubArticle {
  headline: string
  source: string
  datetime: number // unix seconds
  summary: string
  url: string
}

async function fetchFinnhubNews(asset: WatchlistAsset): Promise<FinnhubArticle[]> {
  const token = process.env.FINNHUB_API_KEY!
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const from = sevenDaysAgo.toISOString().split('T')[0]
  const to = new Date().toISOString().split('T')[0]

  let url: string
  if (asset.asset_type === 'equity') {
    url = `https://finnhub.io/api/v1/company-news?symbol=${asset.ticker}&from=${from}&to=${to}&token=${token}`
  } else if (asset.asset_type === 'forex') {
    url = `https://finnhub.io/api/v1/news?category=forex&token=${token}`
  } else {
    // indices and commodities — general market news
    url = `https://finnhub.io/api/v1/news?category=general&token=${token}`
  }

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Finnhub ${res.status} for ${asset.ticker}`)

  const articles: FinnhubArticle[] = await res.json()

  // For general/forex endpoints there's no date filter, so trim client-side
  if (asset.asset_type !== 'equity') {
    const cutoff = sevenDaysAgo.getTime() / 1000
    return articles.filter(a => a.datetime >= cutoff).slice(0, 60)
  }
  return articles.slice(0, 60)
}

// ─── Haiku triage ─────────────────────────────────────────────────────────────

async function triageWithHaiku(
  asset: WatchlistAsset,
  articles: FinnhubArticle[]
): Promise<FinnhubArticle[]> {
  if (articles.length === 0) return []

  const headlineList = articles.map((a, i) => `[${i}] ${a.headline}`).join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: 'You are a financial news relevance classifier. Respond only with valid JSON.',
    messages: [
      {
        role: 'user',
        content:
          `Which of these headlines are directly relevant to ${asset.name} (${asset.ticker}, ${asset.asset_type}${asset.commodity_category ? ', ' + asset.commodity_category : ''})?\n\n` +
          `Return a JSON object with the indices of relevant headlines: {"relevant_indices": [0, 2, 5]}\n` +
          `Include only headlines with material relevance — skip general noise.\n\n` +
          `Headlines:\n${headlineList}`,
      },
    ],
  })

  const text = response.content.find(b => b.type === 'text')?.text ?? ''
  try {
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{"relevant_indices":[]}')
    const indices: number[] = Array.isArray(parsed.relevant_indices)
      ? parsed.relevant_indices
      : []
    return indices
      .filter(i => typeof i === 'number' && i >= 0 && i < articles.length)
      .map(i => articles[i])
  } catch {
    // fallback: pass first 10 if parsing fails
    return articles.slice(0, 10)
  }
}

// ─── Opus synthesis ────────────────────────────────────────────────────────────

interface SynthesizedSignal {
  direction: SignalDirection
  confidence: number
  reasoning: string
  sources: SignalSource[]
  news_window_start: string
}

function assetContext(asset: WatchlistAsset): string {
  if (asset.commodity_category === 'safe-haven') {
    return `${asset.name} is a safe-haven asset. It typically rises when fear, geopolitical risk, or financial stress increases, and falls when risk appetite recovers.`
  }
  if (asset.commodity_category === 'industrial') {
    return `${asset.name} is an industrial commodity. It rises with global growth expectations and falls when recession fears or demand destruction dominate.`
  }
  if (asset.commodity_category === 'energy') {
    return `${asset.name} is an energy commodity driven primarily by supply disruptions, OPEC decisions, and global oil demand.`
  }
  if (asset.asset_type === 'index') {
    return `${asset.name} is a major equity index reflecting broad market sentiment.`
  }
  if (asset.asset_type === 'forex') {
    return `${asset.name} is a forex pair. "buy" means the base currency strengthens vs the quote; "sell" means it weakens.`
  }
  return `${asset.name} (${asset.ticker}) is an equity listed on a US exchange.`
}

async function synthesizeWithOpus(
  asset: WatchlistAsset,
  articles: FinnhubArticle[]
): Promise<SynthesizedSignal | null> {
  const newsWindowStart = new Date(
    Math.min(...articles.map(a => a.datetime)) * 1000
  ).toISOString()

  const articleList = articles.map(a => ({
    headline: a.headline,
    source: a.source,
    published_at: new Date(a.datetime * 1000).toISOString(),
    summary: a.summary?.slice(0, 300) ?? '',
  }))

  const stream = await anthropic.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: `You are a personal financial signal generator — NOT a financial advisor. You produce directional signal observations for personal research only. Never give investment advice or trade execution instructions.

${assetContext(asset)}

Respond with exactly one JSON object matching this schema — no markdown fences, no prose:
{
  "direction": "buy" | "sell" | "hold",
  "confidence": <integer 0–100>,
  "reasoning": "<2–4 sentences explaining the signal based on the news>",
  "sources": [{"headline": "...", "source": "...", "published_at": "ISO8601"}, ...]
}

Be honest about uncertainty — confidence of 35 or 45 is fine. Only use 50 if genuinely neutral.`,
    messages: [
      {
        role: 'user',
        content:
          `Generate a signal observation for ${asset.name} (${asset.ticker}) based on these recent articles:\n\n` +
          JSON.stringify(articleList, null, 2) +
          '\n\nReturn only the JSON object.',
      },
    ],
  })

  const message = await stream.finalMessage()
  const text = message.content.find(b => b.type === 'text')?.text ?? ''

  try {
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '')

    const direction = (['buy', 'sell', 'hold'] as const).includes(parsed.direction)
      ? (parsed.direction as SignalDirection)
      : 'hold'
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 50)))
    const sources: SignalSource[] = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, 8).map((s: Partial<SignalSource>) => ({
          headline: String(s.headline ?? ''),
          source: String(s.source ?? ''),
          published_at: String(s.published_at ?? ''),
        }))
      : articleList.slice(0, 5).map(a => ({
          headline: a.headline,
          source: a.source,
          published_at: a.published_at,
        }))

    return { direction, confidence, reasoning: String(parsed.reasoning ?? ''), sources, news_window_start: newsWindowStart }
  } catch {
    return null
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Vercel cron sends: Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = adminDb()

  const { data: assets, error: fetchError } = await db
    .from('watchlist')
    .select('*')
    .eq('active', true)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const watchlist = (assets ?? []) as WatchlistAsset[]
  const results: { ticker: string; status: string; error?: string }[] = []

  for (const asset of watchlist) {
    try {
      const articles = await fetchFinnhubNews(asset)
      if (articles.length === 0) {
        results.push({ ticker: asset.ticker, status: 'no_news' })
        continue
      }

      const relevant = await triageWithHaiku(asset, articles)
      if (relevant.length === 0) {
        results.push({ ticker: asset.ticker, status: 'no_relevant_news' })
        continue
      }

      const signal = await synthesizeWithOpus(asset, relevant)
      if (!signal) {
        results.push({ ticker: asset.ticker, status: 'synthesis_failed' })
        continue
      }

      const { error: insertError } = await db.from('signals').insert({
        asset_id: asset.id,
        direction: signal.direction,
        confidence: signal.confidence,
        reasoning: signal.reasoning,
        sources: signal.sources,
        news_window_start: signal.news_window_start,
      })

      if (insertError) {
        results.push({ ticker: asset.ticker, status: 'db_error', error: insertError.message })
      } else {
        results.push({ ticker: asset.ticker, status: 'ok' })
      }
    } catch (err) {
      results.push({ ticker: asset.ticker, status: 'error', error: String(err) })
    }
  }

  return NextResponse.json({
    ok: results.every(r => r.status === 'ok'),
    processed: results.filter(r => r.status === 'ok').length,
    total: watchlist.length,
    results,
  })
}
