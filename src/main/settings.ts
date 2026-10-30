import { app, safeStorage } from 'electron'
import { translate } from '@shared/i18n'
import type { Settings } from '@shared/types'
import { isWebhookUrl, webhookKind, type WebhookKind } from '@shared/webhook'
import { getSetting, rebaseAll, setSetting } from './db'

/** Fields derived from stored secrets; never saved as plain settings. */
type Derived = 'hasResendKey' | 'hasTelegramToken' | 'hasWebhook' | 'webhookKind'

const DEFAULTS: Omit<Settings, Derived | 'language'> = {
  emailTo: '',
  emailFrom: 'Price Tracker <onboarding@resend.dev>',
  intervalMinutes: 60,
  threshold: { unit: 'percent', value: 5 },
  desktopNotifications: false,
  launchAtStartup: false,
  manualRate: null,
  telegramEnabled: false,
  telegramChatId: null,
  webhookEnabled: true,
  sniperAlerts: true,
  quietEnabled: false,
  quietStart: 22,
  quietEnd: 7,
  digest: 'off',
  digestHour: 8,
  pausedUntil: null,
  trackSavedForLater: false,
  wishlists: [],
  alertOnTotal: false,
  trmAlert: false,
  trmTarget: null,
  languageChoice: 'auto'
}

const OLD_DEFAULT_FROM = 'Amazon Price Tracker <onboarding@resend.dev>'

export function getSettings(): Settings {
  const { language: saved, ...stored } = getSetting<Partial<Settings>>('settings', {})
  // The app was renamed; move the old default sender name along with it.
  if (stored.emailFrom === OLD_DEFAULT_FROM) stored.emailFrom = DEFAULTS.emailFrom
  const system = app.getLocale().toLowerCase().startsWith('es') ? 'es' : 'en'
  // Before "automatic" existed, the language in use was saved along with any other change:
  // it only counts as a choice when it isn't the PC's own.
  const languageChoice = stored.languageChoice ?? (saved && saved !== system ? saved : 'auto')
  const webhookUrl = getSecret('webhookUrl')
  return {
    ...DEFAULTS,
    ...stored,
    languageChoice,
    language: languageChoice === 'auto' ? system : languageChoice,
    hasResendKey: getSetting<string | null>('resendKey', null) !== null,
    hasTelegramToken: getSetting<string | null>('telegramToken', null) !== null,
    hasWebhook: webhookUrl !== null,
    webhookKind: webhookUrl ? webhookKind(webhookUrl) : null
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const { hasResendKey: _r, hasTelegramToken: _t, hasWebhook: _w, webhookKind: _k, language: _l, ...rest } = patch
  const prev = getSettings()
  const next = { ...prev, ...rest }
  // Switching what alerts compare restarts every base from the current value, so it doesn't fire at once.
  if (next.alertOnTotal !== prev.alertOnTotal) rebaseAll(next.alertOnTotal)
  if (!(next.intervalMinutes >= 15)) next.intervalMinutes = 15
  // The language in use is worked out on every read, never stored.
  const { hasResendKey: _r2, hasTelegramToken: _t2, hasWebhook: _w2, webhookKind: _k2, language: _l2, ...stored } = next
  setSetting('settings', stored)
  app.setLoginItemSettings({ openAtLogin: next.launchAtStartup, args: ['--hidden'] })
  return getSettings()
}

/** Translates into the language chosen in Settings (used for alerts and emails). */
export const tr = (text: string, vars?: Record<string, string | number>): string => translate(getSettings().language, text, vars)

export type SecretName = 'resendKey' | 'telegramToken' | 'webhookUrl'

/** Secrets are encrypted with the Windows user account (DPAPI) and never sent to the UI. */
export function setSecret(name: SecretName, value: string | null): void {
  if (!value) return setSetting(name, null)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available; refusing to store the secret in plain text.')
  setSetting(name, safeStorage.encryptString(value.trim()).toString('base64'))
}

export function getSecret(name: SecretName): string | null {
  const stored = getSetting<string | null>(name, null)
  return stored ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : null
}

export const setResendKey = (key: string | null): void => setSecret('resendKey', key)
export const getResendKey = (): string | null => getSecret('resendKey')

/**
 * Saves the webhook URL, refusing anything that isn't http(s), and returns the service it
 * points at so Settings can show it. Only the kind goes back to the UI, never the URL.
 */
export function setWebhook(url: string | null): WebhookKind | null {
  const clean = url?.trim() ?? ''
  if (!clean) {
    setSecret('webhookUrl', null)
    return null
  }
  if (!isWebhookUrl(clean)) throw new Error('The webhook URL must start with http:// or https://')
  setSecret('webhookUrl', clean)
  return webhookKind(clean)
}
