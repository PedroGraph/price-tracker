import { Notification } from 'electron'
import { volatility } from '@shared/insights'
import { formatUsd } from '@shared/pricing'
import { nextSale } from '@shared/sales'
import type { SaleOutlook } from '@shared/types'
import * as db from './db'
import { sendReport } from './notify'
import { tr } from './settings'

/** Shown in the app from this many days before a sale. */
const SHOW_DAYS = 30
/** The heads-up message goes out this many days before. */
const NOTIFY_DAYS = 7

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * The next big sale and the tracked products most likely to drop in it: the ones that
 * dropped most often in the last 6 months, then the ones whose price moves the most.
 */
export function saleOutlook(now = new Date()): SaleOutlook | null {
  const sale = nextSale(now)
  if (!sale || sale.daysLeft > SHOW_DAYS) return null
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString()
  const drops = db.dropCountsSince(since)
  const likely = db
    .listProducts(true)
    .map((p) => {
      const prices = db
        .getHistory(p.asin)
        .filter((r) => r.source === 'buybox' && r.price !== null && r.checkedAt >= since)
        .map((r) => r.price!)
      return { asin: p.asin, title: p.title, image: p.image, price: p.lastPrice, drops: drops.get(p.asin) ?? 0, volatility: volatility(prices) }
    })
    .filter((p) => p.drops > 0 || p.volatility >= 1)
    .sort((a, b) => b.drops - a.drops || b.volatility - a.volatility)
    .slice(0, 5)
  return { sale, likely }
}

/** Sends the heads-up once per sale, a week before. Safe to call often. */
export async function maybeSendSaleHeadsUp(now = new Date()): Promise<void> {
  const outlook = saleOutlook(now)
  if (!outlook || outlook.sale.daysLeft > NOTIFY_DAYS) return
  const sent = db.getSetting<string[]>('salesNotified', [])
  if (sent.includes(outlook.sale.id)) return
  db.setSetting('salesNotified', [...sent, outlook.sale.id].slice(-20))

  const { sale, likely } = outlook
  const when =
    sale.daysLeft === 0 ? tr('starts today') : tr(sale.daysLeft === 1 ? 'starts tomorrow' : 'starts in {n} days', { n: sale.daysLeft })
  const title = `${sale.name} ${when}${sale.approximate ? ` (${tr('approximate date')})` : ''}`
  const lines = likely.map((p) => `${p.title.slice(0, 70)} — ${formatUsd(p.price)} · ${tr(p.drops === 1 ? 'dropped once' : 'dropped {n} times', { n: p.drops })}`)
  const intro = likely.length ? tr('Your products most likely to drop:') : tr('Keep an eye on your products.')
  const html = `<p>${esc(intro)}</p>${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}`
  const telegram = `🛍️ <b>${esc(title)}</b>\n${esc(intro)}${lines.map((l) => `\n• ${esc(l)}`).join('')}`
  if (Notification.isSupported()) new Notification({ title, body: intro }).show()
  await sendReport(title, html, telegram)
}
