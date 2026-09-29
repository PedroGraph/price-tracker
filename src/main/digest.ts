import { formatCop, formatUsd } from '@shared/pricing'
import { digestDue } from '@shared/schedule'
import * as db from './db'
import { sendReport } from './notify'
import { digestEmail } from './notify/emailTemplate'
import { getSettings, tr } from './settings'

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Sends the daily/weekly summary when it's due. Safe to call often. */
export async function maybeSendDigest(rate: number | null, now = new Date()): Promise<void> {
  const { digest, digestHour } = getSettings()
  if (!digestDue(now, db.getSetting<string | null>('digestSentAt', null), digest, digestHour)) return

  const days = digest === 'weekly' ? 7 : 1
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const intro = tr(days === 1 ? 'Your tracked products over the last 24 hours:' : 'Your tracked products over the last 7 days:')
  const money = (usd: number | null): string =>
    usd === null ? '—' : rate ? `${formatUsd(usd)} (${formatCop(usd * rate)})` : formatUsd(usd)

  const rows = db.listProducts(true).map((p) => {
    const then = db.firstPriceSince(p.asin, since)
    const diff = then !== null && p.lastPrice !== null ? Math.round((p.lastPrice - then) * 100) / 100 : null
    const change =
      diff === null ? tr('new') : diff === 0 ? tr('no change') : `${diff < 0 ? '▼' : '▲'} ${formatUsd(Math.abs(diff))} (${((diff / then!) * 100).toFixed(1)}%)`
    const status = p.available === false ? tr('Out of stock') : p.coupon ? p.coupon : ''
    return { p, then, change, status }
  })
  const alerts = db.countAlertsSince(since)
  const title = tr(digest === 'weekly' ? 'Weekly summary: {products} products, {alerts} alerts' : 'Daily summary: {products} products, {alerts} alerts', {
    products: rows.length,
    alerts
  })

  const html = digestEmail(
    {
      title,
      intro,
      alerts,
      rows: rows.map(({ p, then }) => ({
        title: p.title,
        image: p.image,
        url: p.url,
        price: p.lastPrice,
        before: then,
        lowest: p.lowestPrice,
        available: p.available,
        coupon: p.coupon
      }))
    },
    rate,
    getSettings().language
  )
  const telegram = [
    `🗓 <b>${esc(title)}</b>`,
    ...rows.map(
      ({ p, change, status }) =>
        `\n<a href="${esc(p.url)}">${esc(p.title.slice(0, 60))}</a>\n<b>${esc(money(p.lastPrice))}</b> · ${esc(change)}${status ? ` · ${esc(status)}` : ''}`
    )
  ].join('\n')

  await sendReport(title, html, telegram, true)
  db.setSetting('digestSentAt', now.toISOString())
}
