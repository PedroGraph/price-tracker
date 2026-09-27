import { Notification } from 'electron'
import { formatCop, formatUsd, offerUrl, priceWithCoupon } from '@shared/pricing'
import type { EventType, Product } from '@shared/types'
import { getResendKey, getSettings, tr } from '../settings'
import { isQuiet } from '@shared/schedule'
import { getSetting, setSetting } from '../db'
import { alertEmail, messageEmail, type EmailAlert } from './emailTemplate'
import { toTelegramHtml } from './format'
import { sendTelegram } from './telegram'

export interface Alert {
  product: Product
  type: EventType
  oldPrice: number | null
  newPrice: number | null
  shipping: number | null
  seller: string | null
  sellerId: string | null
}

// English keys, translated with tr() where used.
const LABELS: Record<EventType, string> = {
  price_down: 'Price dropped',
  price_up: 'Price went up',
  out_of_stock: 'Out of stock',
  back_in_stock: 'Back in stock',
  tracking_started: 'Tracking started',
  target_reached: 'Target price reached',
  all_time_low: 'New all-time low',
  coupon_added: 'Coupon available',
  deal_started: 'Deal started'
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
  if (a.type === 'back_in_stock') return tr('Available again at {price}', { price: money(a.newPrice, rate) })
  if (a.type === 'target_reached') {
    return tr('Now {price}, at or below your target of {target}', { price: money(a.newPrice, rate), target: money(a.product.targetPrice, rate) })
  }
  if (a.type === 'coupon_added') {
    const after = priceWithCoupon(a.newPrice, a.product.coupon)
    return after !== null
      ? tr('{coupon} → {price} after the coupon', { coupon: a.product.coupon ?? '', price: money(after, rate) })
      : (a.product.coupon ?? '')
  }
  if (a.type === 'deal_started') return tr('{deal} at {price}', { deal: a.product.deal ?? '', price: money(a.newPrice, rate) })
  if (a.type === 'all_time_low') return tr('{price} is the lowest price since tracking started', { price: money(a.newPrice, rate) })
  return tr('The product is currently unavailable')
}

async function sendEmail(alerts: Alert[], rate: number | null): Promise<void> {
  const { emailTo, emailFrom, language } = getSettings()
  const key = getResendKey()
  if (!key || !emailTo || alerts.length === 0) return

  const cards: EmailAlert[] = alerts.map((a) => ({
    type: a.type,
    title: a.product.title,
    image: a.product.image,
    seller: a.seller,
    url: offerUrl(a.product.asin, a.sellerId),
    inCart: a.product.source === 'cart',
    // Stock alerts show the current price only; the others compare with the base.
    oldPrice: a.type === 'price_up' || a.type === 'price_down' ? a.oldPrice : null,
    newPrice: a.type === 'out_of_stock' ? null : a.newPrice,
    detail: a.type === 'price_up' || a.type === 'price_down' || a.type === 'out_of_stock' ? null : summary(a, rate)
  }))

  const subject =
    alerts.length === 1
      ? `${tr(LABELS[alerts[0].type])}: ${alerts[0].product.title.slice(0, 60)}`
      : tr('{n} price alerts from your Amazon cart', { n: alerts.length })

  await sendRaw({ key, from: emailFrom, to: emailTo, subject, html: alertEmail(cards, rate, language) })
}

/** Emails about the app itself (session lost, scraper broken). Silently skipped without email setup. */
async function sendSystemEmail(subject: string, html: string): Promise<void> {
  const { emailTo, emailFrom } = getSettings()
  const key = getResendKey()
  if (!key || !emailTo) return
  await sendRaw({
    key,
    from: emailFrom,
    to: emailTo,
    subject,
    html: messageEmail(subject, html, getSettings().language)
  })
}

/** Messages about the app itself, sent to every configured channel. */
export async function sendSystemMessage(subject: string, html: string): Promise<void> {
  await sendReport(subject, html, `⚠️ <b>${esc(subject)}</b>\n${toTelegramHtml(html)}`)
}

/** An email and a Telegram message with their own formatting (summaries, warnings). */
export async function sendReport(subject: string, emailHtml: string, telegramHtml: string): Promise<void> {
  const results = await Promise.allSettled([sendSystemEmail(subject, emailHtml), sendTelegram(telegramHtml)])
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed.length) throw failed[0].reason
}

function telegramAlerts(alerts: Alert[], rate: number | null): string {
  return alerts
    .map((a) => {
      const extra = [
        a.shipping ? tr('+ {amount} shipping', { amount: money(a.shipping, rate) }) : '',
        a.seller ? tr('Seller: {seller}', { seller: a.seller }) : ''
      ]
        .filter(Boolean)
        .map((t) => `\n<i>${esc(t)}</i>`)
        .join('')
      return `<b>${tr(LABELS[a.type])}</b>\n<a href="${esc(offerUrl(a.product.asin, a.sellerId))}">${esc(a.product.title.slice(0, 90))}</a>\n${esc(summary(a, rate))}${extra}`
    })
    .join('\n\n')
}

/** Alerts held back during quiet hours, kept in the settings table so they survive a restart. */
const queued = (): Alert[] => getSetting<Alert[]>('queuedAlerts', [])

export function inQuietHours(now = new Date()): boolean {
  const { quietEnabled, quietStart, quietEnd } = getSettings()
  return quietEnabled && isQuiet(now, quietStart, quietEnd)
}

/**
 * Sends price alerts to every enabled channel, or queues them during quiet hours.
 * Channels are independent: one failing doesn't stop the others. Throws the first
 * failure afterwards so it can be reported.
 */
export async function deliverAlerts(alerts: Alert[], rate: number | null): Promise<void> {
  if (alerts.length === 0) return
  if (inQuietHours()) {
    setSetting('queuedAlerts', [...queued(), ...alerts])
    return
  }
  await send(alerts, rate)
}

/** Sends what was held during quiet hours, once they're over. */
export async function flushQueuedAlerts(rate: number | null): Promise<void> {
  const pending = queued()
  if (pending.length === 0 || inQuietHours()) return
  await send(pending, rate)
  setSetting('queuedAlerts', [])
}

async function send(alerts: Alert[], rate: number | null): Promise<void> {
  showDesktop(alerts, rate)
  const results = await Promise.allSettled([sendEmail(alerts, rate), sendTelegram(telegramAlerts(alerts, rate))])
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed.length) throw failed[0].reason
}

/** Returns the Resend email id so it can be looked up in the Resend dashboard. */
export async function sendTestEmail(): Promise<string> {
  const { emailTo, emailFrom } = getSettings()
  const key = getResendKey()
  if (!key) throw new Error('Add your Resend API key first.')
  if (!emailTo) throw new Error('Add a recipient email first.')
  return sendRaw({ key, from: emailFrom, to: emailTo, subject: tr('Price Tracker test'),
    html: messageEmail(tr('Price Tracker test'), `<p>${tr('Email alerts are working. 🎉')}</p>`, getSettings().language)
  })
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

function showDesktop(alerts: Alert[], rate: number | null): void {
  if (!getSettings().desktopNotifications || !Notification.isSupported()) return
  for (const a of alerts) {
    new Notification({ title: `${tr(LABELS[a.type])} — ${a.product.title.slice(0, 50)}`, body: summary(a, rate) }).show()
  }
}

export function showSessionProblem(message: string): void {
  if (Notification.isSupported()) new Notification({ title: 'Price Tracker', body: message }).show()
}
