/** Telegram bot commands, in English and Spanish. */
export type BotCommand = 'help' | 'prices' | 'add' | 'check' | 'pause' | 'resume'

const ALIASES: Record<string, BotCommand> = {
  start: 'help',
  help: 'help',
  ayuda: 'help',
  prices: 'prices',
  precios: 'prices',
  add: 'add',
  agregar: 'add',
  check: 'check',
  revisar: 'check',
  pause: 'pause',
  pausar: 'pause',
  resume: 'resume',
  reanudar: 'resume'
}

/** "/precios", "/agregar@my_bot https://…" → { command, arg }. Null for anything else. */
export function parseCommand(text: string | undefined): { command: BotCommand | 'unknown'; arg: string } | null {
  const m = text?.trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i)
  if (!m) return null
  return { command: ALIASES[m[1].toLowerCase()] ?? 'unknown', arg: (m[2] ?? '').trim() }
}

/** Hours for /pausar: default 8, clamped to 1–168 (a week). */
export function pauseHours(arg: string): number {
  const n = Number.parseFloat(arg.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return 8
  return Math.min(168, Math.max(1, Math.round(n)))
}
