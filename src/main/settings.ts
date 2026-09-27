import { app, safeStorage } from 'electron'
import { translate } from '@shared/i18n'
import type { Settings } from '@shared/types'
import { getSetting, setSetting } from './db'

/** Fields derived from stored secrets; never saved as plain settings. */
type Derived = 'hasResendKey' | 'hasTelegramToken'

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
  quietEnabled: false,
  quietStart: 22,
  quietEnd: 7,
  digest: 'off',
  digestHour: 8
}

const OLD_DEFAULT_FROM = 'Amazon Price Tracker <onboarding@resend.dev>'

export function getSettings(): Settings {
  const stored = getSetting<Partial<Settings>>('settings', {})
  // The app was renamed; move the old default sender name along with it.
  if (stored.emailFrom === OLD_DEFAULT_FROM) stored.emailFrom = DEFAULTS.emailFrom
  return {
    ...DEFAULTS,
    // Until chosen in Settings, follow the Windows display language.
    language: app.getLocale().toLowerCase().startsWith('es') ? 'es' : 'en',
    ...stored,
    hasResendKey: getSetting<string | null>('resendKey', null) !== null,
    hasTelegramToken: getSetting<string | null>('telegramToken', null) !== null
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const { hasResendKey: _r, hasTelegramToken: _t, ...rest } = patch
  const next = { ...getSettings(), ...rest }
  if (!(next.intervalMinutes >= 15)) next.intervalMinutes = 15
  const { hasResendKey: _r2, hasTelegramToken: _t2, ...stored } = next
  setSetting('settings', stored)
  app.setLoginItemSettings({ openAtLogin: next.launchAtStartup, args: ['--hidden'] })
  return getSettings()
}

/** Translates into the language chosen in Settings (used for alerts and emails). */
export const tr = (text: string, vars?: Record<string, string | number>): string => translate(getSettings().language, text, vars)

export type SecretName = 'resendKey' | 'telegramToken'

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
