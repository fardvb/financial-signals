import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createClient } from '@supabase/supabase-js'
import type { WatchlistAsset, SignalDirection, SignalSource } from '@/types'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

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
  datetime: number
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
    url = `https://finnhub.io/api/v1/news?category=general&token=${token}`
  }

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Finnhub ${res.status} for ${asset.ticker}`)

  const articles: FinnhubArticle[] = await res.json()

  if (asset.asset_type !== 'equity') {
    const cutoff = sevenDaysAgo.getTime() / 1000
    return articles.filter(a => a.datetime >= cutoff).slice(0, 40)
  }
  return articles.slice(0, 40)
}

// ─── Groq triage ─────────────────────────────────────────────────────────────

async function triageWithGroq(
  asset: WatchlistAsset,
  articles: FinnhubArticle[]
): Promise<FinnhubArticle[]> {
  if (articles.length === 0) return []

  const headlineList = articles.map((a, i) => `[${i}] ${a.headline}`).join('\n')

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    max_tokens: 256,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a financial news relevance classifier. Return only valid JSON.',
      },
      {
        role: 'user',
        content:
          `Which headlines are directly relevant to ${asset.name} (${asset.ticker}, ${asset.asset_type}${asset.commodity_category ? ', ' + asset.commodity_category : ''})?\n\n` +
          `Return: {"relevant_indices": [0, 2, 5]}\n` +
          `Include only material relevance — skip general noise.\n\n` +
          `Headlines:\n${headlineList}`,
      },
    ],
  })

  const text = response.choices[0].message.content ?? ''
  try {
    const parsed = JSON.parse(text)
    const indices: number[] = Array.isArray(parsed.relevant_indices) ? parsed.relevant_indices : []
    return indices
      .filter(i => typeof i === 'number' && i >= 0 && i < articles.length)
      .map(i => articles[i])
  } catch {
    return articles.slice(0, 8)
  }
}

// ─── Groq synthesis ───────────────────────────────────────────────────────────

interface SynthesizedSignal {
  direction: SignalDirection
  confidence: number
  reasoning: string
  sources: SignalSource[]
  news_window_start: string
}

function assetContext(asset: WatchlistAsset): string {
  if (asset.commodity_category === 'safe-haven')
    return `${asset.name} is a safe-haven asset. It typically rises when fear, geopolitical risk, or financial stress increases, and falls when risk appetite recovers.`
  if (asset.commodity_category === 'industrial')
    return `${asset.name} is an industrial commodity. It rises with global growth expectations and falls when recession fears or demand destruction dominate.`
  if (asset.commodity_category === 'energy')
    return `${asset.name} is an energy commodity driven primarily by supply disruptions, OPEC decisions, and global oil demand.`
  if (asset.asset_type === 'index')
    return `${asset.name} is a major equity index reflecting broad market sentiment.`
  if (asset.asset_type === 'forex')
    return `${asset.name} is a forex pair. "buy" means the base currency strengthens vs the quote; "sell" means it weakens.`
  return `${asset.name} (${asset.ticker}) is a US-listed equity.`
}

async function synthesizeWithGroq(
  asset: WatchlistAsset,
  articles: FinnhubArticle[]
): Promise<SynthesizedSignal | null> {
  const newsWindowStart = new Date(
    Math.min(...articles.map(a => a.datetime)) * 1000
  ).toISOString()

  const articleList = articles.slice(0, 8).map(a => ({
    headline: a.headline,
    source: a.source,
    published_at: new Date(a.datetime * 1000).toISOString(),
    summary: a.summary?.slice(0, 200) ?? '',
  }))

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 800,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          `You are a personal financial signal generator — NOT a financial advisor. Produce directional signal observations for personal research only. Never give investment advice.\n\n` +
          `${assetContext(asset)}\n\n` +
          `Return a single JSON object:\n` +
          `{"direction":"buy"|"sell"|"hold","confidence":0-100,"reasoning":"2-4 sentences","sources":[{"headline":"...","source":"...","published_at":"ISO8601"}]}\n\n` +
          `Be honest about uncertainty — 35 or 45 is fine. Only use 50 if genuinely neutral.`,
      },
      {
        role: 'user',
        content:
          `Generate a signal observation for ${asset.name} (${asset.ticker}) based on:\n\n` +
          JSON.stringify(articleList, null, 2),
      },
    ],
  })

  const text = response.choices[0].message.content ?? ''
  try {
    const parsed = JSON.parse(text)
    const direction = (['buy', 'sell', 'hold'] as const).includes(parsed.direction)
      ? (parsed.direction as SignalDirection)
      : 'hold'
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 50)))
    const sources: SignalSource[] = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, 6).map((s: Partial<SignalSource>) => ({
          headline: String(s.headline ?? ''),
          source: String(s.source ?? ''),
          published_at: String(s.published_at ?? ''),
        }))
      : articleList.slice(0, 5).map(a => ({
          headline: a.headline,
          source: a.source,
          published_at: a.published_at,
        }))

    return {
      direction,
      confidence,
      reasoning: String(parsed.reasoning ?? ''),
      sources,
      news_window_start: newsWindowStart,
    }
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
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

      const relevant = await triageWithGroq(asset, articles)
      if (relevant.length === 0) {
        results.push({ ticker: asset.ticker, status: 'no_relevant_news' })
        continue
      }

      const signal = await synthesizeWithGroq(asset, relevant)
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

    // Space out calls to respect Groq free tier rate limits
    await sleep(4000)
  }

  return NextResponse.json({
    ok: results.every(r => r.status === 'ok'),
    processed: results.filter(r => r.status === 'ok').length,
    total: watchlist.length,
    results,
  })
}
