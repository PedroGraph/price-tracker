import { getSetting, setSetting } from './db'
import { sendSystemEmail, showSessionProblem } from './notify'

/** Consecutive broken runs before we tell the user the scraper needs fixing. */
export const BROKEN_RUNS_BEFORE_ALERT = 3
/** Minutes to wait before retrying after a failed run; then the normal interval. */
export const RETRY_DELAYS_MIN = [5, 15, 30]

interface Health {
  brokenRuns: number
  brokenAlerted: boolean
  sessionAlerted: boolean
}

const read = (): Health => getSetting<Health>('health', { brokenRuns: 0, brokenAlerted: false, sessionAlerted: false })
const write = (h: Health): void => setSetting('health', h)

export type RunOutcome =
  | { kind: 'ok' }
  | { kind: 'broken'; reason: string }
  | { kind: 'session'; message: string }
  | { kind: 'error'; message: string }

/**
 * Updates the failure counters after a run and sends the "something is wrong" /
 * "back to normal" messages at most once per incident.
 */
export async function recordOutcome(outcome: RunOutcome): Promise<void> {
  const h = read()

  if (outcome.kind === 'session') {
    if (!h.sessionAlerted) {
      showSessionProblem(outcome.message)
      await safe(() =>
        sendSystemEmail(
          'Action needed: sign in to Amazon again',
          `<p>${outcome.message}</p><p>Open Amazon Price Tracker and click <b>Open Amazon</b>. Price checks are paused until then.</p>`
        )
      )
      h.sessionAlerted = true
    }
    return write(h)
  }
  if (h.sessionAlerted) h.sessionAlerted = false

  if (outcome.kind === 'broken') {
    h.brokenRuns++
    if (h.brokenRuns >= BROKEN_RUNS_BEFORE_ALERT && !h.brokenAlerted) {
      showSessionProblem('Amazon prices could not be read. The page layout may have changed.')
      await safe(() =>
        sendSystemEmail(
          'Amazon Price Tracker can no longer read prices',
          `<p>The last ${h.brokenRuns} checks could not read Amazon's pages:</p><p><code>${escapeHtml(outcome.reason)}</code></p>
           <p>Amazon probably changed its page layout. The selectors live in <code>src/main/scraper/extractors.ts</code>.
           No false price or stock alerts are sent while this lasts.</p>`
        )
      )
      h.brokenAlerted = true
    }
    return write(h)
  }

  if (outcome.kind === 'ok') {
    if (h.brokenAlerted) {
      await safe(() => sendSystemEmail('Amazon Price Tracker is reading prices again', '<p>Price checks are back to normal.</p>'))
    }
    h.brokenRuns = 0
    h.brokenAlerted = false
  }
  write(h)
}

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch {
    // A failed system email must not break the tracking loop.
  }
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
