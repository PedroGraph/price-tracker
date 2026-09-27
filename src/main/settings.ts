import { app, safeStorage } from 'electron'
import type { Settings } from '@shared/types'
import { getSetting, setSetting } from './db'

const DEFAULTS: Omit<Settings, 'hasResendKey'> = {
  emailTo: '',
  emailFrom: 'Amazon Price Tracker <onboarding@resend.dev>',
  intervalMinutes: 60,
  threshold: { unit: 'percent', value: 5 },
  desktopNotifications: false,
  launchAtStartup: false,
  manualRate: null
}

export function getSettings(): Settings {
  return {
    ...DEFAULTS,
    ...getSetting<Partial<Settings>>('settings', {}),
    hasResendKey: getSetting<string | null>('resendKey', null) !== null
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const { hasResendKey: _ignored, ...rest } = patch
  const next = { ...getSettings(), ...rest }
  if (!(next.intervalMinutes >= 15)) next.intervalMinutes = 15
  const { hasResendKey: _h, ...stored } = next
  setSetting('settings', stored)
  app.setLoginItemSettings({ openAtLogin: next.launchAtStartup, args: ['--hidden'] })
  return getSettings()
}

/** The Resend key is encrypted with the Windows user account (DPAPI) and never sent to the UI. */
export function setResendKey(key: string | null): void {
  if (!key) return setSetting('resendKey', null)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available; refusing to store the key in plain text.')
  setSetting('resendKey', safeStorage.encryptString(key.trim()).toString('base64'))
}

export function getResendKey(): string | null {
  const stored = getSetting<string | null>('resendKey', null)
  return stored ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : null
}
