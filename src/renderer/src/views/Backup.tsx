import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { BackupInfo } from '../../../main/backup'
import type { Notify } from '../App'
import { useT } from '../i18n'
import { Toggle } from '../ui'

const MIN_PASSWORD = 8
const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

/** Create a backup (optionally with keys, then always password-protected) or restore one. */
export function Backup({ notify }: { notify: Notify }) {
  const { t, locale } = useT()
  const [mode, setMode] = useState<'idle' | 'create' | 'restore'>('idle')
  const [includeKeys, setIncludeKeys] = useState(false)
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [picked, setPicked] = useState<BackupInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const needsPassword = includeKeys || protect
  const passwordOk = !needsPassword || (password.length >= MIN_PASSWORD && password === confirm)

  const reset = (): void => {
    setMode('idle')
    setIncludeKeys(false)
    setProtect(false)
    setPassword('')
    setConfirm('')
    setPicked(null)
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.api.createBackup({ includeKeys, password: needsPassword ? password : null })
      if (path) {
        notify(t('Backup saved in {path}', { path }))
        reset()
      }
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (): Promise<void> => {
    try {
      const info = await window.api.pickBackup()
      if (info) {
        setPicked(info)
        setPassword('')
        setMode('restore')
      }
    } catch (e) {
      notify(cleanError(e), true)
    }
  }

  const restore = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.restoreBackup(picked?.encrypted ? password : null)
      notify(t('Backup restored. Reloading…'))
      // Everything on screen (settings, products) changed: start fresh.
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="row between">
        <div>
          <h3>{t('Backup')}</h3>
          <p className="sub">{t('Products, full price history, events and settings in one file, to move to another PC or recover after reinstalling.')}</p>
        </div>
        {mode === 'idle' && (
          <div className="row">
            <button className="btn" onClick={() => setMode('create')}>
              {t('Create backup')}
            </button>
            <button className="btn" onClick={() => void pick()}>
              {t('Restore')}
            </button>
          </div>
        )}
      </div>

      {mode === 'create' && (
        <div className="backup-panel">
          <div className="toggle-row">
            <div>
              <strong>{t('Include keys (Resend, Telegram)')}</strong>
              <small>{t('So you don’t have to set up email and Telegram again after restoring.')}</small>
            </div>
            <Toggle on={includeKeys} onChange={setIncludeKeys} label={t('Include keys (Resend, Telegram)')} />
          </div>
          {includeKeys && (
            <div className="risk">
              <ShieldAlert size={20} />
              <div>
                <strong>{t('Risk: anyone with this file and its password can use your keys')}</strong>
                <p>
                  {t(
                    'They could send email from your Resend account and write as your Telegram bot. The file is encrypted with the password below: use a strong one you don’t use anywhere else, keep the file somewhere private and never share it. If it leaks, create new keys in Resend and @BotFather.'
                  )}
                </p>
              </div>
            </div>
          )}
          {!includeKeys && (
            <div className="toggle-row">
              <div>
                <strong>{t('Protect with a password')}</strong>
                <small>{t('Optional without keys. Your price history can say a lot about what you buy.')}</small>
              </div>
              <Toggle on={protect} onChange={setProtect} label={t('Protect with a password')} />
            </div>
          )}
          {needsPassword && (
            <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={t('Password (8+ characters)')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder={t('Repeat the password')}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
          {needsPassword && password && !passwordOk && (
            <p className="hint bad-text">
              {password.length < MIN_PASSWORD ? t('At least 8 characters.') : t('The passwords don’t match.')}
            </p>
          )}
          {needsPassword && (
            <p className="hint">{t('There is no way to recover a forgotten password: without it, the backup can’t be opened.')}</p>
          )}
          <p className="hint">{t('The Amazon session is never included: after restoring, sign in to Amazon again.')}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!passwordOk || busy} onClick={() => void create()}>
              {busy ? t('Saving…') : t('Save backup')}
            </button>
            <button className="btn link" onClick={reset}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {mode === 'restore' && picked && (
        <div className="backup-panel">
          <p style={{ margin: '4px 0 8px' }}>
            {t('Backup from {date}', { date: new Date(picked.createdAt).toLocaleString(locale) })}
            {!picked.encrypted && (
              <span className="muted">
                {' · '}
                {t('{products} products, {readings} price readings', { products: picked.products ?? 0, readings: picked.readings ?? 0 })}
                {picked.hasKeys ? ` · ${t('includes keys')}` : ''}
              </span>
            )}
          </p>
          {picked.encrypted && (
            <input
              type="password"
              autoComplete="current-password"
              placeholder={t('Backup password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ maxWidth: 320 }}
            />
          )}
          <div className="risk">
            <ShieldAlert size={20} />
            <div>
              <strong>{t('This replaces all your current data')}</strong>
              <p>{t('Products, history and settings on this PC are overwritten with the backup’s. Create a backup first if you want to keep them.')}</p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy || (picked.encrypted && !password)} onClick={() => void restore()}>
              {busy ? t('Restoring…') : t('Restore backup')}
            </button>
            <button className="btn link" onClick={reset}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
