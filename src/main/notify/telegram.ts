import { getSecret, getSettings, tr } from '../settings'

const API = 'https://api.telegram.org'

export async function call<T>(token: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal
  })
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
  // Never echo the URL: it contains the bot token.
  if (!json.ok) throw new Error(`Telegram: ${json.description ?? `HTTP ${res.status}`}`)
  return json.result as T
}

function requireToken(): string {
  const token = getSecret('telegramToken')
  if (!token) throw new Error('Add your Telegram bot token first.')
  return token
}

/** Checks a token and returns the bot's @username. */
export async function botName(token: string): Promise<string> {
  const me = await call<{ username: string }>(token, 'getMe')
  return me.username
}

/**
 * Finds the chat of whoever last wrote to the bot (the user sends /start first).
 * Returns the chat id and a label to show in the UI.
 */
export async function detectChat(): Promise<{ id: string; label: string }> {
  const updates = await call<{ message?: { chat: { id: number; type: string; first_name?: string; username?: string; title?: string } } }[]>(
    requireToken(),
    'getUpdates'
  )
  const chat = updates
    .map((u) => u.message?.chat)
    .filter((c): c is NonNullable<typeof c> => !!c && c.type === 'private')
    .at(-1)
  if (!chat) throw new Error('No messages yet. Open your bot in Telegram, send /start, then try again.')
  return { id: String(chat.id), label: chat.title ?? chat.username ?? chat.first_name ?? String(chat.id) }
}

/** Sends one HTML-formatted message. Does nothing when Telegram isn't set up and enabled. */
export async function sendTelegram(html: string, force = false): Promise<void> {
  const { telegramEnabled, telegramChatId } = getSettings()
  const token = getSecret('telegramToken')
  if (!token || !telegramChatId || (!telegramEnabled && !force)) return
  await call(token, 'sendMessage', { chat_id: telegramChatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true })
}

export async function sendTelegramTest(): Promise<void> {
  requireToken()
  if (!getSettings().telegramChatId) throw new Error('Detect your chat first.')
  await sendTelegram(`✅ <b>Price Tracker</b>\n${tr('Telegram alerts are working.')}`, true)
}
