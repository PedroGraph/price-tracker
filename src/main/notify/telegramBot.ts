import { buySignal } from '@shared/pricing'
import { parseCommand, pauseHours } from '@shared/botCommands'
import { formatCop, formatUsd } from '@shared/pricing'
import * as db from '../db'
import { currentRate } from '../exchange'
import { resolveAsin } from '../resolveAsin'
import { getSecret, getSettings, saveSettings, tr } from '../settings'
import { events, runCheck, status } from '../tracker'
import { call, detectChat } from './telegram'
import { flushQueuedAlerts } from './index'

/**
 * Two-way bot: answers commands from the connected chat, via long polling (one request
 * waits up to 25 s for new messages). Messages from any other chat are ignored.
 */
interface Update {
  update_id: number
  message?: { text?: string; chat: { id: number } }
}

let controller: AbortController | null = null
let running = false
/** Set by stopBot(); the loop checks it after every wait. */
let stopped = false

export function syncBot(): void {
  const { telegramEnabled, telegramChatId } = getSettings()
  const shouldRun = telegramEnabled && !!telegramChatId && !!getSecret('telegramToken')
  if (shouldRun) stopped = false
  if (shouldRun && !running) void loop()
  if (!shouldRun) stopBot()
}

export function stopBot(): void {
  stopped = true
  controller?.abort()
  controller = null
}

async function loop(): Promise<void> {
  running = true
  let offset = db.getSetting<number>('telegramOffset', 0)
  let registered = false
  while (!stopped) {
    const { telegramEnabled, telegramChatId } = getSettings()
    const token = getSecret('telegramToken')
    if (!telegramEnabled || !telegramChatId || !token) break
    controller = new AbortController()
    try {
      if (!registered) {
        await registerCommands(token)
        registered = true
      }
      const updates = await call<Update[]>(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, controller.signal)
      for (const u of updates) {
        offset = u.update_id + 1
        db.setSetting('telegramOffset', offset)
        if (u.message && String(u.message.chat.id) === telegramChatId) await handle(u.message.text).catch(() => undefined)
      }
    } catch (e) {
      if (stopped || controller?.signal.aborted) break
      // Network hiccup or Telegram error: wait a bit before trying again.
      await new Promise((r) => setTimeout(r, 15_000))
    }
  }
  running = false
}

/** Shows the commands in Telegram's "/" menu. */
async function registerCommands(token: string): Promise<void> {
  const commands = [
    ['precios', tr('Current prices')],
    ['agregar', tr('Track a product: /agregar <link>')],
    ['revisar', tr('Check prices now')],
    ['pausar', tr('Pause alerts: /pausar <hours>')],
    ['reanudar', tr('Resume alerts')],
    ['ayuda', tr('What I can do')]
  ].map(([command, description]) => ({ command, description }))
  await call(token, 'setMyCommands', { commands })
}

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

async function reply(html: string): Promise<void> {
  const { telegramChatId } = getSettings()
  const token = getSecret('telegramToken')
  if (token && telegramChatId) {
    await call(token, 'sendMessage', { chat_id: telegramChatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true })
  }
}

async function handle(text: string | undefined): Promise<void> {
  const cmd = parseCommand(text)
  if (!cmd) return
  switch (cmd.command) {
    case 'prices':
      return reply(pricesMessage())
    case 'add': {
      if (!cmd.arg) return reply(tr('Send it like this: /agregar https://www.amazon.com/dp/…'))
      const asin = await resolveAsin(cmd.arg).catch(() => null)
      if (!asin) return reply(tr("That doesn't look like an Amazon product link or ASIN."))
      db.addManualProduct(asin)
      events.emit('status', { ...status })
      void runCheck()
      return reply(tr('Tracking {asin}. I’ll check its price now.', { asin }))
    }
    case 'check':
      void runCheck()
      return reply(status.running ? tr('A check is already running.') : tr('Checking prices now…'))
    case 'pause': {
      const hours = pauseHours(cmd.arg)
      const until = new Date(Date.now() + hours * 3_600_000)
      saveSettings({ pausedUntil: until.toISOString() })
      events.emit('status', { ...status })
      return reply(tr('Alerts paused for {hours} h. They’ll arrive together when the pause ends, or send /reanudar.', { hours }))
    }
    case 'resume':
      saveSettings({ pausedUntil: null })
      events.emit('status', { ...status })
      await flushQueuedAlerts(currentRate()).catch(() => undefined)
      return reply(tr('Alerts resumed.'))
    default:
      return reply(helpMessage())
  }
}

function helpMessage(): string {
  return [
    `🤖 <b>Price Tracker</b>`,
    `/precios — ${esc(tr('Current prices'))}`,
    `/agregar &lt;link&gt; — ${esc(tr('Track a product'))}`,
    `/revisar — ${esc(tr('Check prices now'))}`,
    `/pausar &lt;${esc(tr('hours'))}&gt; — ${esc(tr('Pause alerts'))}`,
    `/reanudar — ${esc(tr('Resume alerts'))}`
  ].join('\n')
}

const SIGNAL = { low: '🟢', normal: '⚪', high: '🔴', unknown: '' } as const

function pricesMessage(): string {
  const rate = currentRate()
  const products = db.listProducts(true)
  if (products.length === 0) return tr('No products yet. Send /agregar <link> to track one.')
  const money = (usd: number | null): string => (usd === null ? '—' : rate ? `${formatUsd(usd)} (${formatCop(usd * rate)})` : formatUsd(usd))
  const lines = products.map((p) => {
    const change =
      p.basePrice && p.lastPrice !== null && p.lastPrice !== p.basePrice
        ? ` ${p.lastPrice < p.basePrice ? '▼' : '▲'}${Math.abs(((p.lastPrice - p.basePrice) / p.basePrice) * 100).toFixed(1)}%`
        : ''
    const signal = SIGNAL[buySignal({ current: p.lastPrice, avg: p.avg30, min: p.lowest30, runs: p.runs30, spanDays: p.spanDays30 })]
    const state = p.available === false ? ` · ${tr('Out of stock')}` : ''
    return `${signal} <a href="${esc(p.url)}">${esc(p.title.slice(0, 55))}</a>\n<b>${esc(money(p.lastPrice))}</b>${change}${esc(state)}`
  })
  const paused = getSettings().pausedUntil
  const note = paused && Date.parse(paused) > Date.now() ? `\n\n⏸ ${esc(tr('Alerts paused until {time}', { time: new Date(paused).toLocaleString() }))}` : ''
  return `📦 <b>${esc(tr('Current prices'))}</b>\n\n${lines.join('\n\n')}${note}`
}

/** "Detect chat" also reads updates, so the bot loop steps aside while it runs. */
export async function detectChatWhilePaused(): Promise<{ id: string; label: string }> {
  stopBot()
  while (running) await new Promise((r) => setTimeout(r, 100))
  try {
    return await detectChat()
  } finally {
    syncBot()
  }
}
