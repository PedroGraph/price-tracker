import { app } from 'electron'
import { release } from 'node:os'
import * as db from './db'
import { getSettings } from './settings'
import { status } from './tracker'

/**
 * A plain-text report to paste when asking for help. Deliberately leaves out the email
 * address, keys, Telegram chat and anything else personal: only versions, settings that
 * shape the checks, product ids and the recent runs.
 */
export function diagnosticsReport(): string {
  const s = getSettings()
  const products = db.listProducts(true)
  const runs = db.listRuns(20)
  const lines = [
    'Price Tracker diagnostics',
    `App ${app.getVersion()} · Electron ${process.versions.electron} · Windows ${release()} · ${app.isPackaged ? 'installed' : 'development'}`,
    `Session: ${status.session} · last run ${status.lastRunAt ?? 'never'} · next ${status.nextRunAt ?? '-'}`,
    `Every ${s.intervalMinutes} min · threshold ${s.threshold.value} ${s.threshold.unit} · language ${s.language}`,
    `Email ${s.hasResendKey && s.emailTo ? 'on' : 'off'} · Telegram ${s.telegramEnabled && s.telegramChatId ? 'on' : 'off'} · quiet hours ${s.quietEnabled ? `${s.quietStart}-${s.quietEnd}` : 'off'} · summary ${s.digest}`,
    `Update: ${status.update.status}${status.update.error ? ` (${status.update.error})` : ''}`,
    '',
    `Products (${products.length}):`,
    ...products.map(
      (p) =>
        `  ${p.asin} ${p.source}${p.trackOffers ? ' +sellers' : ''} · ${p.available === false ? 'unavailable' : (p.lastPrice ?? '-')} · checked ${p.lastCheckedAt ?? 'never'}`
    ),
    '',
    'Recent runs:',
    ...runs.map(
      (r) =>
        `  ${r.startedAt} ${r.outcome.padEnd(7)} ${Math.round(r.durationMs / 1000)}s · ${r.checked} checked, ${r.unreadable} unreadable, ${r.alerts} alerts${r.message ? ` · ${r.message}` : ''}`
    )
  ]
  return lines.join('\n')
}
