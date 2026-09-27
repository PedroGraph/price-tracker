/** Local-time scheduling helpers for quiet hours and summaries. Pure, so they're easy to test. */

/**
 * True when `now` falls inside the quiet window. Hours are 0–23 local time; a window that
 * wraps midnight (22 → 7) is supported. Equal start and end means "no quiet hours".
 */
export function isQuiet(now: Date, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false
  const h = now.getHours()
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour
}

/** The next moment the quiet window ends, strictly after `now`. */
export function quietEndsAt(now: Date, endHour: number): Date {
  const end = new Date(now)
  end.setHours(endHour, 0, 0, 0)
  if (end <= now) end.setDate(end.getDate() + 1)
  return end
}

export type DigestFrequency = 'off' | 'daily' | 'weekly'

/** The latest scheduled summary time at or before `now` (weekly summaries go out on Mondays). */
export function lastDigestSlot(now: Date, frequency: Exclude<DigestFrequency, 'off'>, hour: number): Date {
  const slot = new Date(now)
  slot.setHours(hour, 0, 0, 0)
  if (slot > now) slot.setDate(slot.getDate() - 1)
  if (frequency === 'weekly') {
    // getDay(): Sunday = 0, Monday = 1.
    const back = (slot.getDay() + 6) % 7
    slot.setDate(slot.getDate() - back)
  }
  return slot
}

/** A summary is due when its latest slot has passed and nothing was sent since. */
export function digestDue(now: Date, lastSent: string | null, frequency: DigestFrequency, hour: number): boolean {
  if (frequency === 'off') return false
  const slot = lastDigestSlot(now, frequency, hour)
  return !lastSent || Date.parse(lastSent) < slot.getTime()
}
