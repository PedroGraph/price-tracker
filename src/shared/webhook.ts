/**
 * Webhook messages: one saved URL, formatted for whichever service it points at.
 * Discord and Slack get their own JSON, ntfy gets a plain body with a high priority,
 * and anything else gets generic JSON (Home Assistant automations, your own server).
 */

export type WebhookKind = 'discord' | 'slack' | 'ntfy' | 'json'

export interface WebhookMessage {
  /** One line, e.g. "Price dropped". */
  title: string
  /** Plain-text lines, already translated. */
  lines: string[]
  /** The product or app link, when there is one. */
  url?: string | null
  /** A product picture, when the service can show one. */
  image?: string | null
}

/** Only http(s): a webhook is something the app POSTs to. */
export function isWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url.trim())
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Which service a URL belongs to. Self-hosted ntfy is recognised by its host name
 * (ntfy.example.com); everything unknown is treated as generic JSON.
 */
export function webhookKind(url: string): WebhookKind {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase()
    if (/^(www\.)?(discord|discordapp)\.com$/.test(host)) return 'discord'
    if (host === 'hooks.slack.com') return 'slack'
    if (host === 'ntfy.sh' || host.includes('ntfy')) return 'ntfy'
    return 'json'
  } catch {
    return 'json'
  }
}

/** The request body and headers for one message; pure, so it can be tested. */
export function webhookPayload(kind: WebhookKind, msg: WebhookMessage): { headers: Record<string, string>; body: string } {
  const text = msg.lines.join('\n')
  if (kind === 'discord') {
    const embed: Record<string, unknown> = {
      title: msg.title,
      description: text,
      color: 0x12b39b,
      timestamp: new Date().toISOString()
    }
    if (msg.url) embed.url = msg.url
    if (msg.image) embed.thumbnail = { url: msg.image }
    return {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Price Tracker', embeds: [embed] })
    }
  }
  if (kind === 'slack') {
    const title = msg.url ? `<${msg.url}|${msg.title}>` : `*${msg.title}*`
    return {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${title}\n${text}` })
    }
  }
  if (kind === 'ntfy') {
    // The title goes in the body: Spanish titles don't fit in an HTTP header.
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
      Priority: 'high',
      Tags: 'moneybag'
    }
    if (msg.url && /^[\x20-\x7E]+$/.test(msg.url)) headers.Click = msg.url
    return { headers, body: `${msg.title}\n${text}` }
  }
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'Price Tracker', title: msg.title, message: text, url: msg.url ?? null, image: msg.image ?? null })
  }
}
