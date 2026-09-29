import { Notification } from 'electron'
import { formatCop } from '@shared/pricing'
import type { Trm } from '@shared/types'
import * as db from './db'
import { sendReport } from './notify'
import { getSettings, tr } from './settings'

/**
 * Colombia's official exchange rate (TRM), published daily by the Superintendencia
 * Financiera on datos.gov.co. No key needed. Checked at most once an hour.
 */
const SOURCE = 'https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1'
const MAX_AGE = 60 * 60_000

export function cachedTrm(): Trm | null {
  return db.getSetting<Trm | null>('trm', null)
}

export async function refreshTrm(force = false): Promise<Trm | null> {
  const cached = cachedTrm()
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < MAX_AGE) return cached
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(10_000) })
    const [row] = (await res.json()) as { valor?: string; vigenciadesde?: string }[]
    const value = Number(row?.valor)
    if (!(value > 0)) throw new Error('No TRM in the response')
    const fresh: Trm = { value, date: (row.vigenciadesde ?? '').slice(0, 10), fetchedAt: new Date().toISOString() }
    db.setSetting('trm', fresh)
    return fresh
  } catch {
    return cached
  }
}

/**
 * Alerts once when the TRM goes down to your target or below, and again only after it has
 * gone back above it. Safe to call often.
 */
export async function maybeSendTrmAlert(): Promise<void> {
  const { trmAlert, trmTarget } = getSettings()
  if (!trmAlert || !trmTarget) return
  const trm = await refreshTrm()
  if (!trm) return
  const below = trm.value <= trmTarget
  const wasBelow = db.getSetting<boolean>('trmBelow', false)
  if (below === wasBelow) return
  db.setSetting('trmBelow', below)
  if (!below) return
  const title = tr('The dollar is down to {trm}', { trm: formatCop(trm.value) })
  const body = tr('The official TRM for {date} is {trm}, at or below your target of {target}. A good day to buy in dollars.', {
    date: trm.date,
    trm: formatCop(trm.value),
    target: formatCop(trmTarget)
  })
  if (Notification.isSupported()) new Notification({ title, body }).show()
  await sendReport(title, `<p>${body}</p>`, `💵 <b>${title}</b>\n${body}`)
}
