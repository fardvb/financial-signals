import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createClient } from '@supabase/supabase-js'
import type { CalibrationProfile, ConfidenceBucket, EventCategory, SignalDirection, SignalSource, WatchlistAsset } from '@/types'
import { getAssetClass } from '@/lib/scoring/assetClass'
import { computeConfidence, type CalibrationSnapshot, type TriagedArticle as ScoringTriagedArticle } from '@/lib/scoring/confidence'
import { EVENT_CATEGORIES, isEventCategory } from '@/lib/scoring/eventWeights'
import { DEDUP_WINDOW_HOURS, MIN_N_FOR_PROMPT_CONTEXT } from '@/lib/scoring/constants'
import { getQuote } from '@/lib/finnhub/quote'

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

interface TriagedArticle extends FinnhubArticle {
  category: EventCategory
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
): Promise<TriagedArticle[]> {
  if (articles.length === 0) return []

  const headlineList = articles.map((a, i) => `[${i}] ${a.headline}`).join('\n')
  const categoryList = EVENT_CATEGORIES.join(', ')

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    max_tokens: 500,
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
          `For each relevant headline, also tag its event category from this exact list: ${categoryList}.\n\n` +
          `Return: {"tagged": [{"index": 0, "category": "geopolitical-conflict"}, {"index": 2, "category": "corporate-earnings"}]}\n` +
          `Include only material relevance — skip general noise.\n\n` +
          `Headlines:\n${headlineList}`,
      },
    ],
  })

  const text = response.choices[0].message.content ?? ''
  try {
    const parsed = JSON.parse(text)
    const tagged: { index?: number; category?: string }[] = Array.isArray(parsed.tagged) ? parsed.tagged : []
    const result: TriagedArticle[] = []
    for (const t of tagged) {
      if (typeof t.index !== 'number' || t.index < 0 || t.index >= articles.length) continue
      const category: EventCategory = isEventCategory(t.category) ? t.category : 'other'
      result.push({ ...articles[t.index], category })
    }
    return result
  } catch {
    return articles.slice(0, 8).map(a => ({ ...a, category: 'other' as EventCategory }))
  }
}

// ─── Groq synthesis ───────────────────────────────────────────────────────────

interface SynthesizedSignal {
  direction: SignalDirection
  llm_confidence: number
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
  articles: TriagedArticle[],
  calibrationContext: string
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
          (calibrationContext ? `${calibrationContext}\n\n` : '') +
          `Return a single JSON object:\n` +
          `{"direction":"buy"|"sell"|"hold","confidence":0-100,"reasoning":"2-4 sentences","sources":[{"headline":"...","source":"...","published_at":"ISO8601"}]}\n\n` +
          `Use the full 0-100 range based on genuine conviction: 10-30 when evidence is thin, conflicting, or mostly noise; ` +
          `40-60 when directionally suggestive but not decisive; 70-90 when multiple credible sources strongly and consistently ` +
          `support one direction; 90+ only for extremely clear-cut, high-magnitude events. Don't default to the middle out of caution.`,
      },
      {
        role: 'user',
        content:
          `Generate a signal observation for ${asset.name} (${asset.ticker}) based on:\n\n` +
          JSON.stringify(articleList, null, 2),
      },
    ],
  })

  // The LLM regenerates headline/source text rather than echoing the article object,
  // so match it back to the original article to recover a real, clickable URL.
  const findUrl = (headline: string): string | undefined => {
    const norm = (s: string) => s.toLowerCase().trim()
    const target = norm(headline)
    const exact = articles.find(a => norm(a.headline) === target)
    if (exact) return exact.url
    const partial = articles.find(a => norm(a.headline).includes(target) || target.includes(norm(a.headline)))
    return partial?.url
  }

  const text = response.choices[0].message.content ?? ''
  try {
    const parsed = JSON.parse(text)
    const direction = (['buy', 'sell', 'hold'] as const).includes(parsed.direction)
      ? (parsed.direction as SignalDirection)
      : 'hold'
    const llm_confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 50)))
    const sources: SignalSource[] = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, 6).map((s: Partial<SignalSource>) => ({
          headline: String(s.headline ?? ''),
          source: String(s.source ?? ''),
          published_at: String(s.published_at ?? ''),
          url: findUrl(String(s.headline ?? '')),
        }))
      : articleList.slice(0, 5).map(a => ({
          headline: a.headline,
          source: a.source,
          published_at: a.published_at,
          url: findUrl(a.headline),
        }))

    return {
      direction,
      llm_confidence,
      reasoning: String(parsed.reasoning ?? ''),
      sources,
      news_window_start: newsWindowStart,
    }
  } catch {
    return null
  }
}

// ─── Calibration context ──────────────────────────────────────────────────────

function formatCalibrationContext(asset: WatchlistAsset, profiles: CalibrationProfile[]): string {
  const relevant = profiles.filter(p => p.total_count >= MIN_N_FOR_PROMPT_CONTEXT)
  if (relevant.length === 0) return ''

  const lines = relevant.map(p => {
    const hitRate = Math.round((p.correct_count / p.total_count) * 100)
    const n = Math.round(p.total_count)
    return `- ${p.direction} calls on ${asset.ticker} at ${bucketLabel(p.confidence_bucket)} confidence have hit ${hitRate}% of the time (n=${n}, decayed).`
  })

  return `Your own track record for this asset (factor this in honestly):\n${lines.join('\n')}`
}

function bucketLabel(bucket: string): string {
  if (bucket === 'low') return '0-39%'
  if (bucket === 'moderate') return '40-59%'
  if (bucket === 'high') return '60-79%'
  return '80-100%'
}

function calibrationByBucket(
  profiles: CalibrationProfile[],
  direction: SignalDirection
): Partial<Record<ConfidenceBucket, CalibrationSnapshot>> {
  const out: Partial<Record<ConfidenceBucket, CalibrationSnapshot>> = {}
  for (const p of profiles) {
    if (p.direction !== direction) continue
    out[p.confidence_bucket] = { correctCount: p.correct_count, totalCount: p.total_count }
  }
  return out
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized', debug: { secret_set: !!process.env.CRON_SECRET, got_header: !!auth } }, { status: 401 })
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
      // Dedup guard: two GitHub Actions runs land ~12h apart, but manual reruns
      // (workflow_dispatch) or overlap could otherwise double-fire the same window.
      const { data: recent } = await db
        .from('signals')
        .select('created_at')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recent && Date.now() - new Date(recent.created_at).getTime() < DEDUP_WINDOW_HOURS * 60 * 60 * 1000) {
        results.push({ ticker: asset.ticker, status: 'skipped_recent' })
        continue
      }

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

      const { data: calibrationRows } = await db
        .from('calibration_profiles')
        .select('*')
        .eq('asset_id', asset.id)
      const profiles = (calibrationRows ?? []) as CalibrationProfile[]
      const calibrationContext = formatCalibrationContext(asset, profiles)

      const signal = await synthesizeWithGroq(asset, relevant, calibrationContext)
      if (!signal) {
        results.push({ ticker: asset.ticker, status: 'synthesis_failed' })
        continue
      }

      const assetClass = getAssetClass(asset)
      const scoringArticles: ScoringTriagedArticle[] = relevant.map(a => ({ source: a.source, category: a.category }))
      const confidence = computeConfidence({
        llmConfidence: signal.llm_confidence,
        triaged: scoringArticles,
        assetClass,
        direction: signal.direction,
        calibrationByBucket: calibrationByBucket(profiles, signal.direction),
      })

      const price_at_signal = await getQuote(asset.price_symbol)

      const { error: insertError } = await db.from('signals').insert({
        asset_id: asset.id,
        direction: signal.direction,
        confidence,
        reasoning: signal.reasoning,
        sources: signal.sources,
        news_window_start: signal.news_window_start,
        price_at_signal,
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
    ok: results.every(r => r.status === 'ok' || r.status === 'skipped_recent'),
    processed: results.filter(r => r.status === 'ok').length,
    total: watchlist.length,
    results,
  })
}
