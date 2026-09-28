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
