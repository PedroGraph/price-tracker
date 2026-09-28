import { useRef, useState } from 'react'
import { formatCop, formatUsd } from '@shared/pricing'
import type { Settings, Status, UpdateState } from '@shared/types'
import type { Notify } from '../App'
import { useT } from '../i18n'
import { useMoney } from '../money'
import { Segmented, Toggle } from '../ui'
import { Backup } from './Backup'
import { Diagnostics } from './Diagnostics'
import { UNITS } from './ProductDetail'

const INTERVALS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 h' },
  { value: '120', label: '2 h' },
  { value: '240', label: '4 h' }
]

export function HourSelect({ value, onChange, disabled }: { value: number; onChange: (h: number) => void; disabled?: boolean }) {
  return (
    <select className="hour" value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  )
}

// English keys, translated where shown.
const UPDATE_LABEL: Record<UpdateState['status'], string> = {
  idle: '',
  checking: 'Checking for updates…',
  downloading: 'Downloading the new version…',
  ready: 'A new version is ready.',
  'up-to-date': 'You have the latest version.',
  error: ''
}

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

export function SettingsView({
  settings,
  status,
  onSaved,
  notify
}: {
  settings: Settings
  status: Status | null
  onSaved: (s: Settings) => void
  notify: Notify
}) {
  const { currency, setCurrency } = useMoney()
  const { t, tn } = useT()
  const [draft, setDraft] = useState(settings)
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [sending, setSending] = useState(false)
  const [tgToken, setTgToken] = useState('')
  const [tgBusy, setTgBusy] = useState(false)

  const tg = async (fn: () => Promise<string | void>): Promise<void> => {
    setTgBusy(true)
    try {
      const msg = await fn()
      if (msg) notify(msg)
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setTgBusy(false)
    }
  }

  const saveTgToken = (): Promise<void> =>
    tg(async () => {
      const bot = await window.api.setTelegramToken(tgToken)
      setTgToken('')
      setDraft((d) => ({ ...d, hasTelegramToken: true }))
      return t('Bot @{bot} connected. Now open it in Telegram, send /start and click “Detect chat”.', { bot: bot ?? '' })
    })

  const detectChat = (): Promise<void> =>
    tg(async () => {
      const label = await window.api.detectTelegramChat()
      const saved = await window.api.getSettings()
      setDraft(saved)
      onSaved(saved)
      return t('Alerts will go to {chat}.', { chat: label })
    })
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Partial<Settings>>({})
  const rate = draft.manualRate ?? status?.exchangeRate?.rate ?? null
  const signedIn = status?.session === 'logged_in'

  // Every change saves on its own; typing is debounced and batched.
  const save = (patch: Partial<Settings>, delay = 0): void => {
    setDraft((d) => ({ ...d, ...patch }))
    pending.current = { ...pending.current, ...patch }
    clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      const batch = pending.current
      pending.current = {}
      try {
        onSaved(await window.api.saveSettings(batch))
        notify(t('Saved.'))
      } catch (e) {
        notify(cleanError(e), true)
      }
    }, delay)
  }

  const saveKey = async (): Promise<void> => {
    if (!key.trim()) return
    await window.api.setResendKey(key)
    setKey('')
    setShowKey(false)
    setDraft((d) => ({ ...d, hasResendKey: true }))
    onSaved({ ...draft, hasResendKey: true })
    notify(t('API key saved (encrypted).'))
  }

  const sendTest = async (): Promise<void> => {
    setSending(true)
    try {
      await saveKey()
      await window.api.saveSettings({ emailTo: draft.emailTo, emailFrom: draft.emailFrom })
      const id = await window.api.sendTestEmail()
      notify(t('Resend accepted the email to {to} (id {id}). Not in your inbox? Check spam and resend.com/emails.', { to: draft.emailTo, id }))
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setSending(false)
    }
  }

  let equivalent = ''
  if (draft.threshold.unit === 'USD' && rate) equivalent = `≈ ${formatCop(draft.threshold.value * rate)}`
  if (draft.threshold.unit === 'COP' && rate) equivalent = `≈ ${formatUsd(draft.threshold.value / rate)}`
  if (draft.threshold.unit === 'COP' && !rate) equivalent = t('Needs an exchange rate')

  return (
    <div className="settings">
      <section className="card row between">
        <div>
          <h3>{t('Amazon account')}</h3>
          <div className="status-line">
            <span className={`dot ${signedIn ? 'on' : 'off'}`} />
            {signedIn
              ? t('Signed in · the app keeps the session between restarts')
              : status?.session === 'captcha'
                ? t('Amazon is asking for a CAPTCHA')
                : t('Not signed in')}
          </div>
        </div>
        <div className="row">
          {signedIn && (
            <button
              className="btn link"
              onClick={() =>
                void window.api.signOut().then(
                  () => notify(t('Signed out of Amazon.')),
                  (e) => notify(cleanError(e), true)
                )
              }
            >
              {t('Sign out')}
            </button>
          )}
          <button className="btn" onClick={() => void window.api.openAmazon()}>
            {t('Open Amazon')}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>{t('Email alerts')}</h3>
        <p className="sub">{t('Sent with your own Resend account.')}</p>
        <label className="field-label">Resend API key</label>
        <div className="row">
          <input
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            className="mono"
            placeholder={draft.hasResendKey ? `••••••••••••••••••••  ${t('saved (encrypted)')}` : 're_…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => void saveKey().catch((e) => notify(cleanError(e), true))}
            onKeyDown={(e) => e.key === 'Enter' && void saveKey().catch((err) => notify(cleanError(err), true))}
          />
          <button className="btn" onClick={() => setShowKey(!showKey)} disabled={!key}>
            {showKey ? t('Hide') : t('Show')}
          </button>
        </div>
        {draft.hasResendKey && (
          <button
            className="btn link"
            onClick={() =>
              void window.api.setResendKey(null).then(() => {
                setDraft((d) => ({ ...d, hasResendKey: false }))
                notify(t('API key removed.'))
              })
            }
          >
            {t('Remove saved key')}
          </button>
        )}
        <label className="field-label">{t('Send alerts to')}</label>
        <input
          type="email"
          style={{ maxWidth: 380 }}
          placeholder="you@example.com"
          value={draft.emailTo}
          onChange={(e) => save({ emailTo: e.target.value }, 800)}
        />
        <label className="field-label">{t('From')}</label>
        <input type="text" value={draft.emailFrom} onChange={(e) => save({ emailFrom: e.target.value }, 800)} />
        <p className="hint">{t('Without a verified domain in Resend, keep onboarding@resend.dev and send to the email you signed up with.')}</p>
        <div style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={() => void sendTest()} disabled={sending}>
            {sending ? t('Sending…') : t('Send test email')}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <div>
            <h3>{t('Telegram alerts')}</h3>
            <p className="sub">{t('Get the same alerts in a Telegram chat with your own bot.')}</p>
          </div>
          <Toggle
            on={draft.telegramEnabled}
            onChange={(v) => save({ telegramEnabled: v })}
            label={t('Telegram alerts')}
          />
        </div>
        <ol className="steps">
          <li>
            {tn('In Telegram, open {botfather}, send {newbot} and copy the token it gives you.', {
              botfather: <b>@BotFather</b>,
              newbot: <code>/newbot</code>
            })}
          </li>
          <li>{t('Paste the token here.')}</li>
          <li>
            {tn('Open your new bot, send {start}, then click {detect}.', { start: <code>/start</code>, detect: <b>{t('Detect chat')}</b> })}
          </li>
        </ol>
        <label className="field-label">{t('Bot token')}</label>
        <div className="row">
          <input
            type="password"
            autoComplete="off"
            className="mono"
            placeholder={draft.hasTelegramToken ? `••••••••••••••••••••  ${t('saved (encrypted)')}` : '123456789:AA…'}
            value={tgToken}
            onChange={(e) => setTgToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && tgToken && void saveTgToken()}
          />
          <button className="btn" onClick={() => void saveTgToken()} disabled={!tgToken || tgBusy}>
            {t('Save')}
          </button>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void detectChat()} disabled={!draft.hasTelegramToken || tgBusy}>
            {t('Detect chat')}
          </button>
          <button
            className="btn primary"
            onClick={() => void tg(async () => (await window.api.sendTelegramTest(), t('Test message sent to Telegram.')))}
            disabled={!draft.telegramChatId || tgBusy}
          >
            {t('Send test message')}
          </button>
          {draft.hasTelegramToken && (
            <button
              className="btn link"
              onClick={() =>
                void tg(async () => {
                  await window.api.setTelegramToken(null)
                  save({ telegramChatId: null, telegramEnabled: false })
                  setDraft((d) => ({ ...d, hasTelegramToken: false, telegramChatId: null, telegramEnabled: false }))
                  return t('Telegram disconnected.')
                })
              }
            >
              {t('Disconnect')}
            </button>
          )}
        </div>
        <p className="hint">{draft.telegramChatId ? t('Chat connected (id {id}).', { id: draft.telegramChatId }) : t('No chat connected yet.')}</p>
      </section>

      <section className="card">
        <h3>{t('Global alert threshold')}</h3>
        <p className="sub">{t('Applies to products without their own threshold.')}</p>
        <div style={{ marginTop: 14 }}>
          <Segmented options={UNITS} value={draft.threshold.unit} onChange={(unit) => save({ threshold: { ...draft.threshold, unit } })} />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <input
            className="short mono"
            type="number"
            min={0}
            step="any"
            value={draft.threshold.value}
            onChange={(e) => save({ threshold: { ...draft.threshold, value: Number(e.target.value) } }, 800)}
          />
          {equivalent && <span className="muted">{equivalent}</span>}
        </div>
      </section>

      <section className="card">
        <h3>{t('Summary')}</h3>
        <p className="sub">{t('A recap of every product by email and Telegram. Weekly summaries go out on Mondays.')}</p>
        <div className="row" style={{ marginTop: 14 }}>
          <Segmented
            options={[
              { value: 'off', label: t('Off') },
              { value: 'daily', label: t('Daily') },
              { value: 'weekly', label: t('Weekly') }
            ]}
            value={draft.digest}
            onChange={(v) => save({ digest: v })}
          />
          <span className="muted">{t('at')}</span>
          <HourSelect value={draft.digestHour} onChange={(h) => save({ digestHour: h })} disabled={draft.digest === 'off'} />
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <div>
            <h3>{t('Quiet hours')}</h3>
            <p className="sub">{t('Price alerts in this window wait and arrive together when it ends.')}</p>
          </div>
          <Toggle on={draft.quietEnabled} onChange={(v) => save({ quietEnabled: v })} label={t('Quiet hours')} />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <span className="muted">{t('From')}</span>
          <HourSelect value={draft.quietStart} onChange={(h) => save({ quietStart: h })} disabled={!draft.quietEnabled} />
          <span className="muted">{t('to')}</span>
          <HourSelect value={draft.quietEnd} onChange={(h) => save({ quietEnd: h })} disabled={!draft.quietEnabled} />
        </div>
        <p className="hint">{t("Warnings about the app itself (signed out of Amazon, pages can't be read) are always sent.")}</p>
        {draft.pausedUntil && Date.parse(draft.pausedUntil) > Date.now() && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="signal normal">
              ⏸ {t('Alerts paused until {time}', { time: new Date(draft.pausedUntil).toLocaleString() })}
            </span>
            <button className="btn link" onClick={() => save({ pausedUntil: null })}>
              {t('Resume now')}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h3>{t('Check frequency')}</h3>
        <div style={{ marginTop: 14 }}>
          <Segmented options={INTERVALS} value={String(draft.intervalMinutes)} onChange={(v) => save({ intervalMinutes: Number(v) })} />
        </div>
        <p className="hint">{t('Minimum 15 minutes between checks.')}</p>
      </section>

      <section className="card">
        <div className="row between">
          <div>
            <h3>{t('Display currency')}</h3>
            <p className="sub">{t('Prices are tracked in USD; COP is converted with the rate below.')}</p>
          </div>
          <Segmented
            options={[
              { value: 'USD', label: 'USD' },
              { value: 'COP', label: 'COP' }
            ]}
            value={currency}
            onChange={setCurrency}
          />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <span className="muted">
            1 USD = <strong className="mono">{rate ? rate.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—'}</strong> COP ·{' '}
            {draft.manualRate ? t('manual') : (status?.exchangeRate?.source ?? 'open.er-api.com')}
          </span>
          <button
            className="btn link"
            onClick={() =>
              void window.api.refreshRate().then(
                () => notify(t('Exchange rate updated.')),
                (e) => notify(cleanError(e), true)
              )
            }
          >
            {t('Refresh')}
          </button>
        </div>
        <label className="field-label">{t('Manual rate (optional, overrides the fetched one)')}</label>
        <input
          className="short mono"
          type="number"
          min={0}
          placeholder={t('e.g. {example}', { example: '4100' })}
          value={draft.manualRate ?? ''}
          onChange={(e) => save({ manualRate: e.target.value ? Number(e.target.value) : null }, 800)}
        />
        <p className="hint">{t("Amazon doesn't publish the rate it uses, so COP amounts are a close estimate.")}</p>
      </section>

      <section className="card row between">
        <div>
          <h3>{t('Your data')}</h3>
          <p className="sub">{t('Every price reading of every product, as a CSV file for Excel or Google Sheets.')}</p>
        </div>
        <button
          className="btn"
          onClick={() =>
            void window.api.exportCsv().then(
              (path) => path && notify(t('Saved {path}', { path })),
              (e) => notify(cleanError(e), true)
            )
          }
        >
          {t('Export CSV')}
        </button>
      </section>

      <Backup notify={notify} />

      <section className="card">
        <h3>{t('App')}</h3>
        <div className="toggle-row" style={{ marginTop: 8 }}>
          <div>
            <strong>{t('Language')}</strong>
            <small>{t('Used in the app and in email and Telegram alerts.')}</small>
          </div>
          <Segmented
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' }
            ]}
            value={draft.language}
            onChange={(v) => save({ language: v })}
          />
        </div>
        <div className="toggle-row">
          <div>
            <strong>{t('Windows notifications')}</strong>
            <small>{t('Also show alerts as desktop notifications.')}</small>
          </div>
          <Toggle on={draft.desktopNotifications} onChange={(v) => save({ desktopNotifications: v })} label={t('Windows notifications')} />
        </div>
        <div className="toggle-row">
          <div>
            <strong>{t('Start with Windows')}</strong>
            <small>{t('Opens minimized in the tray when you sign in to Windows.')}</small>
          </div>
          <Toggle on={draft.launchAtStartup} onChange={(v) => save({ launchAtStartup: v })} label={t('Start with Windows')} />
        </div>
        <div className="toggle-row">
          <div>
            <strong>{t('Version {version}', { version: status?.appVersion ?? '' })}</strong>
            <small>
              {status?.update.status === 'error'
                ? status.update.error
                : t(UPDATE_LABEL[status?.update.status ?? 'idle'] || 'Updates are downloaded automatically from GitHub Releases.')}
            </small>
          </div>
          {status?.update.status === 'ready' ? (
            <button className="btn primary" onClick={() => void window.api.installUpdate()}>
              {t('Restart to update')}
            </button>
          ) : (
            <button
              className="btn"
              disabled={status?.update.status === 'checking' || status?.update.status === 'downloading'}
              onClick={() => void window.api.checkForUpdates()}
            >
              {t('Check for updates')}
            </button>
          )}
        </div>
      </section>
      <Diagnostics status={status} notify={notify} />
    </div>
  )
}
