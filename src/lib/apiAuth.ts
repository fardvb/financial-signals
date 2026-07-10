import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

const MAX_FAILED_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

// Best-effort limiter: Vercel serverless instances don't share memory, so this
// bounds attempts per warm instance, not globally. The real defense is the
// high-entropy secret + timing-safe compare; this just adds brute-force friction.
const failedAttempts = new Map<string, number[]>()

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for')
  return fwd ? fwd.split(',')[0].trim() : 'unknown'
}

function recentFailures(ip: string): number[] {
  const now = Date.now()
  return (failedAttempts.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
}

/**
 * Auth gate for the cron endpoints. Returns a 429/401 response to send back,
 * or null when the request is authorized.
 */
export function guardCronRequest(request: NextRequest): NextResponse | null {
  const ip = clientIp(request)

  if (recentFailures(ip).length >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  // Fail closed: an unset secret must never turn into a matchable "Bearer undefined".
  const secret = process.env.CRON_SECRET
  const provided = request.headers.get('authorization') ?? ''
  // Hash both sides to equal-length buffers so timingSafeEqual is usable and
  // the comparison leaks nothing about the secret's length or prefix.
  const authorized =
    !!secret &&
    timingSafeEqual(
      createHash('sha256').update(provided).digest(),
      createHash('sha256').update(`Bearer ${secret}`).digest()
    )

  if (!authorized) {
    const failures = recentFailures(ip)
    failures.push(Date.now())
    if (failedAttempts.size > 10_000) failedAttempts.clear()
    failedAttempts.set(ip, failures)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
