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

/** Sites the app is allowed to open in the user's browser. Anything else is ignored. */
const EXTERNAL = ['amazon.com', 'github.com', 'resend.com', 't.me', 'telegram.org']

export function isAllowedExternal(url: string): boolean {
  const u = parse(url)
  return !!u && u.protocol === 'https:' && EXTERNAL.some((d) => isHost(u.hostname, d))
}
