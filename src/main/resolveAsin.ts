import { parseAsin } from '@shared/pricing'

/** Accepts a bare ASIN, a product URL, or a short amzn.to / a.co link (followed to the product page). */
export async function resolveAsin(input: string): Promise<string | null> {
  const direct = parseAsin(input)
  if (direct) return direct
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  // Only Amazon's own hosts are ever fetched.
  if (url.protocol !== 'https:' || !/^(amzn\.to|a\.co|amzn\.com|www\.amazon\.com|amazon\.com)$/i.test(url.hostname)) return null
  const res = await fetch(url, { method: 'GET', redirect: 'follow' })
  return parseAsin(res.url)
}
