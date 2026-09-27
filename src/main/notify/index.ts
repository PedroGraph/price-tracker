import { Notification } from 'electron'
import { formatCop, formatUsd } from '@shared/pricing'
import type { EventType, Product } from '@shared/types'
import { getResendKey, getSettings } from '../settings'

export interface Alert {
  product: Product
  type: EventType
  oldPrice: number | null
  newPrice: number | null
  shipping: number | null
  seller: string | null
}

const LABELS: Record<EventType, string> = {
  price_down: 'Price dropped',
  price_up: 'Price went up',
  out_of_stock: 'Out of stock',
  back_in_stock: 'Back in stock',
  tracking_started: 'Tracking started',
  target_reached: 'Target price reached',
  all_time_low: 'New all-time low'
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function money(usd: number | null, rate: number | null): string {
  if (usd === null) return '—'
  return rate ? `${formatUsd(usd)} (${formatCop(usd * rate)})` : formatUsd(usd)
}

function summary(a: Alert, rate: number | null): string {
  if (a.type === 'price_down' || a.type === 'price_up') {
    const pct = a.oldPrice ? (((a.newPrice! - a.oldPrice) / a.oldPrice) * 100).toFixed(1) : '?'
    return `${money(a.oldPrice, rate)} → ${money(a.newPrice, rate)} (${Number(pct) > 0 ? '+' : ''}${pct}%)`
  }
  if (a.type === 'back_in_stock') return `Available again at ${money(a.newPrice, rate)}`
  if (a.type === 'target_reached') return `Now ${money(a.newPrice, rate)}, at or below your target of ${money(a.product.targetPrice, rate)}`
  if (a.type === 'all_time_low') return `${money(a.newPrice, rate)} is the lowest price since tracking started`
  return 'The product is currently unavailable'
}

export async function sendEmail(alerts: Alert[], rate: number | null): Promise<void> {
  const { emailTo, emailFrom } = getSettings()
  const key = getResendKey()
  if (!key || !emailTo || alerts.length === 0) return

  const rows = alerts
    .map((a) => {
      const shipping = a.shipping ? `<br><small>+ ${esc(money(a.shipping, rate))} shipping</small>` : ''
      const seller = a.seller ? `<br><small>Seller: ${esc(a.seller)}</small>` : ''
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #eee">
        <strong>${LABELS[a.type]}</strong><br>
        <a href="${esc(a.product.url)}">${esc(a.product.title)}</a><br>
        ${esc(summary(a, rate))}${shipping}${seller}</td></tr>`
    })
    .join('')

  const subject =
    alerts.length === 1
      ? `${LABELS[alerts[0].type]}: ${alerts[0].product.title.slice(0, 60)}`
      : `${alerts.length} price alerts from your Amazon cart`

  await sendRaw({
    key,
    from: emailFrom,
    to: emailTo,
    subject,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px"><h2>Amazon Price Tracker</h2>
      <table style="width:100%;border-collapse:collapse">${rows}</table></div>`
  })
}

/** Emails about the app itself (session lost, scraper broken). Silently skipped without email setup. */
export async function sendSystemEmail(subject: string, html: string): Promise<void> {
  const { emailTo, emailFrom } = getSettings()
  const key = getResendKey()
  if (!key || !emailTo) return
  await sendRaw({
    key,
    from: emailFrom,
    to: emailTo,
    subject,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px"><h2>Amazon Price Tracker</h2>${html}</div>`
  })
}

/** Returns the Resend email id so it can be looked up in the Resend dashboard. */
export async function sendTestEmail(): Promise<string> {
  const { emailTo, emailFrom } = getSettings()
  const key = getResendKey()
  if (!key) throw new Error('Add your Resend API key first.')
  if (!emailTo) throw new Error('Add a recipient email first.')
  return sendRaw({ key, from: emailFrom, to: emailTo, subject: 'Amazon Price Tracker test', html: '<p>Email alerts are working. 🎉</p>' })
}

async function sendRaw(m: { key: string; from: string; to: string; subject: string; html: string }): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${m.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html })
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { id: string }).id
}

export function showDesktop(alerts: Alert[], rate: number | null): void {
  if (!getSettings().desktopNotifications || !Notification.isSupported()) return
  for (const a of alerts) {
    new Notification({ title: `${LABELS[a.type]} — ${a.product.title.slice(0, 50)}`, body: summary(a, rate) }).show()
  }
}

export function showSessionProblem(message: string): void {
  if (Notification.isSupported()) new Notification({ title: 'Amazon Price Tracker', body: message }).show()
}
