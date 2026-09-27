import { formatCop, formatUsd } from '@shared/pricing'
import { digestDue } from '@shared/schedule'
import * as db from './db'
import { sendReport } from './notify'
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
    return { p, change, status }
  })
  const alerts = db.countAlertsSince(since)
  const title = tr(digest === 'weekly' ? 'Weekly summary: {products} products, {alerts} alerts' : 'Daily summary: {products} products, {alerts} alerts', {
    products: rows.length,
    alerts
  })

  const html = `<p>${esc(intro)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${rows
        .map(
          ({ p, change, status }) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">
            <a href="${esc(p.url)}">${esc(p.title.slice(0, 80))}</a><br>
            <b>${esc(money(p.lastPrice))}</b> · ${esc(change)} · ${esc(tr('lowest {price}', { price: money(p.lowestPrice) }))}${status ? ` · ${esc(status)}` : ''}
          </td></tr>`
        )
        .join('')}
    </table>`
  const telegram = [
    `🗓 <b>${esc(title)}</b>`,
    ...rows.map(
      ({ p, change, status }) =>
        `\n<a href="${esc(p.url)}">${esc(p.title.slice(0, 60))}</a>\n<b>${esc(money(p.lastPrice))}</b> · ${esc(change)}${status ? ` · ${esc(status)}` : ''}`
    )
  ].join('\n')

  await sendReport(title, html, telegram)
  db.setSetting('digestSentAt', now.toISOString())
}
