import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { open, seal, type Sealed } from './backupCrypto'
import * as db from './db'
import { getSecret, setSecret, tr, type SecretName } from './settings'

/**
 * Backup files: every product, price reading, event and setting. Keys (Resend, Telegram)
 * are optional and force password encryption. The Amazon session is never included:
 * it's encrypted for this Windows account, and signing in again takes a minute.
 */
const APP = 'price-tracker-backup'
const FORMAT = 1
const SECRETS: SecretName[] = ['resendKey', 'telegramToken']

interface Payload {
  schema: number
  appVersion: string
  createdAt: string
  data: Record<string, Record<string, unknown>[]>
  secrets?: Partial<Record<SecretName, string>>
}

type BackupFile = { app: typeof APP; format: number; createdAt: string } & ({ payload: Payload } | { sealed: Sealed })

export interface BackupInfo {
  createdAt: string
  encrypted: boolean
  products?: number
  readings?: number
  hasKeys?: boolean
}

export async function writeBackup(path: string, opts: { includeKeys: boolean; password: string | null }): Promise<void> {
  if (opts.includeKeys && !opts.password) throw new Error(tr('A password is required to include keys.'))
  const payload: Payload = {
    schema: db.schemaVersion(),
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    data: db.dumpForBackup()
  }
  if (opts.includeKeys) {
    payload.secrets = Object.fromEntries(SECRETS.map((s) => [s, getSecret(s)]).filter(([, v]) => v)) as Payload['secrets']
  }
  const file: BackupFile = opts.password
    ? { app: APP, format: FORMAT, createdAt: payload.createdAt, sealed: seal(JSON.stringify(payload), opts.password) }
    : { app: APP, format: FORMAT, createdAt: payload.createdAt, payload }
  await writeFile(path, JSON.stringify(file), 'utf8')
}

async function readBackupFile(path: string): Promise<BackupFile> {
  let file: BackupFile
  try {
    file = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(tr("This isn't a Price Tracker backup."))
  }
  if (file?.app !== APP) throw new Error(tr("This isn't a Price Tracker backup."))
  if (file.format > FORMAT) throw new Error(tr('This backup comes from a newer version. Update the app first.'))
  return file
}

/** What the file contains, shown before asking to restore. Encrypted files only reveal their date. */
export async function inspectBackup(path: string): Promise<BackupInfo> {
  const file = await readBackupFile(path)
  if ('sealed' in file) return { createdAt: file.createdAt, encrypted: true }
  return summary(file.payload, false)
}

function summary(p: Payload, encrypted: boolean): BackupInfo {
  return {
    createdAt: p.createdAt,
    encrypted,
    products: p.data.products?.length ?? 0,
    readings: p.data.price_history?.length ?? 0,
    hasKeys: !!p.secrets && Object.keys(p.secrets).length > 0
  }
}

/** Replaces all current data with the backup's. */
export async function restoreBackup(path: string, password: string | null): Promise<BackupInfo> {
  const file = await readBackupFile(path)
  let payload: Payload
  if ('sealed' in file) {
    if (!password) throw new Error(tr('This backup is protected with a password.'))
    try {
      payload = JSON.parse(open(file.sealed, password))
    } catch (e) {
      throw new Error(tr(e instanceof Error ? e.message : String(e)))
    }
  } else {
    payload = file.payload
  }
  if (payload.schema > db.schemaVersion()) throw new Error(tr('This backup comes from a newer version. Update the app first.'))
  db.restoreFromBackup(payload.data)
  for (const [name, value] of Object.entries(payload.secrets ?? {})) {
    if (SECRETS.includes(name as SecretName) && typeof value === 'string') setSecret(name as SecretName, value)
  }
  return summary(payload, 'sealed' in file)
}
