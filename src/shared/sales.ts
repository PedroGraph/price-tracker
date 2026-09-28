/**
 * Amazon's big sale days. Black Friday and Cyber Monday follow fixed rules; Prime Day and
 * Prime Big Deal Days are announced each year, so their dates here are the usual ones
 * (second week of July and of October) and marked as approximate.
 */

export interface SaleEvent {
  id: string
  name: string
  /** Local date, YYYY-MM-DD. */
  start: string
  days: number
  approximate: boolean
}

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The n-th given weekday (0 = Sunday) of a month (0 = January). */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1)
  return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7)
}

export function saleEvents(year: number): SaleEvent[] {
  const thanksgiving = nthWeekday(year, 10, 4, 4)
  const blackFriday = new Date(year, 10, thanksgiving.getDate() + 1)
  const cyberMonday = new Date(year, 10, thanksgiving.getDate() + 4)
  return [
    { id: `prime-day-${year}`, name: 'Prime Day', start: iso(nthWeekday(year, 6, 2, 2)), days: 2, approximate: true },
    { id: `prime-october-${year}`, name: 'Prime Big Deal Days', start: iso(nthWeekday(year, 9, 2, 2)), days: 2, approximate: true },
    { id: `black-friday-${year}`, name: 'Black Friday', start: iso(blackFriday), days: 1, approximate: false },
    { id: `cyber-monday-${year}`, name: 'Cyber Monday', start: iso(cyberMonday), days: 1, approximate: false }
  ]
}

/** The next sale that hasn't ended, with the whole days left until it starts (0 = today or running). */
export function nextSale(now = new Date()): (SaleEvent & { daysLeft: number }) | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const all = [...saleEvents(now.getFullYear()), ...saleEvents(now.getFullYear() + 1)]
  for (const e of all.sort((a, b) => a.start.localeCompare(b.start))) {
    const [y, m, d] = e.start.split('-').map(Number)
    const start = new Date(y, m - 1, d)
    const end = new Date(y, m - 1, d + e.days)
    if (end <= today) continue
    return { ...e, daysLeft: Math.max(0, Math.round((start.getTime() - today.getTime()) / 86_400_000)) }
  }
  return null
}
