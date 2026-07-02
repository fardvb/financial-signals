export async function getQuote(symbol: string): Promise<number | null> {
  const token = process.env.FINNHUB_API_KEY!
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
    { cache: 'no-store' }
  )
  if (!res.ok) return null

  const data = await res.json()
  return typeof data.c === 'number' && data.c > 0 ? data.c : null
}
