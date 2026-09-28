import type { SearchParams } from './types'
/** URL checks used to keep windows on Amazon and external links on known sites. */

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const isHost = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`)

/** https on amazon.com or one of its subdomains (www, smile, the sign-in pages…). */
export function isAmazonUrl(url: string): boolean {
  const u = parse(url)
  return !!u && u.protocol === 'https:' && isHost(u.hostname, 'amazon.com')
}

/** An Amazon wishlist link (…/hz/wishlist/ls/ID or the older registry path). */
export function wishlistId(url: string): string | null {
  const u = parse(url.trim())
  if (!u || !isAmazonUrl(u.toString())) return null
  const m = u.pathname.match(/\/(?:hz\/wishlist\/ls|gp\/registry\/wishlist)\/([A-Z0-9]{8,16})/i)
  return m ? m[1].toUpperCase() : null
}

/** Sites the app is allowed to open in the user's browser. Anything else is ignored. */
const EXTERNAL = ['amazon.com', 'github.com', 'resend.com', 't.me', 'telegram.org']

export function isAllowedExternal(url: string): boolean {
  const u = parse(url)
  return !!u && u.protocol === 'https:' && EXTERNAL.some((d) => isHost(u.hostname, d))
}

/**
 * The Amazon search URL for these parameters, or null when they look wrong. The price
 * range becomes Amazon's `p_36` refinement (USD cents), replacing any previous one.
 */
export function searchUrl(p: SearchParams): string | null {
  const query = typeof p.query === 'string' ? p.query.trim() : ''
  if (!query || query.length > 200) return null
  const rh = typeof p.rh === 'string' ? p.rh : ''
  const sort = typeof p.sort === 'string' ? p.sort : ''
  if (rh.length > 1000 || !/^[\w:%,|.\-]*$/.test(rh) || !/^[\w-]{0,40}$/.test(sort)) return null
  const cents = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? String(Math.round(v * 100)) : '')
  const [min, max] = [cents(p.minPrice), cents(p.maxPrice)]
  const parts = rh.split(',').filter((r) => r && !r.startsWith('p_36:'))
  if (min || max) parts.push(`p_36:${min}-${max}`)
  const url = new URL('https://www.amazon.com/s')
  url.searchParams.set('k', query)
  if (parts.length) url.searchParams.set('rh', parts.join(','))
  if (sort) url.searchParams.set('s', sort)
  return url.toString()
}

/** Amazon's "Coupons" search refinement (Deals & discounts → Coupons). */
export const COUPON_FILTER = 'p_n_deal_type:210906366011'

/**
 * A short search for products like this one: the title before its first comma, dash or
 * bracket, without condition words, cut to six words. "Apple MacBook Pro 2023 with M3
 * chip (14-inch…) (Renewed)" → "Apple MacBook Pro 2023 with M3".
 */
export function relatedQuery(title: string): string {
  const head = title
    .replace(/[([{].*?[)\]}]/g, ' ')
    .split(/[,|–—]| - /)[0]
    .replace(/\b(renewed|renovado|reacondicionado|used|usado)\b/gi, ' ')
  return head.split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
}
