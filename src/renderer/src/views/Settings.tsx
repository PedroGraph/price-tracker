import { useRef, useState } from 'react'
import { formatCop, formatUsd } from '@shared/pricing'
import type { Settings, Status } from '@shared/types'
import type { Notify } from '../App'
import { useMoney } from '../money'
import { Segmented, Toggle } from '../ui'
import { UNITS } from './ProductDetail'

const INTERVALS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 h' },
  { value: '120', label: '2 h' },
  { value: '240', label: '4 h' }
]

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
      return `Bot @${bot} connected. Now open it in Telegram, send /start and click “Detect chat”.`
    })

  const detectChat = (): Promise<void> =>
    tg(async () => {
      const label = await window.api.detectTelegramChat()
      const saved = await window.api.getSettings()
      setDraft(saved)
      onSaved(saved)
      return `Alerts will go to ${label}.`
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
        notify('Saved.')
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
    notify('API key saved (encrypted).')
  }

  const sendTest = async (): Promise<void> => {
    setSending(true)
    try {
      await saveKey()
      await window.api.saveSettings({ emailTo: draft.emailTo, emailFrom: draft.emailFrom })
      const id = await window.api.sendTestEmail()
      notify(`Resend accepted the email to ${draft.emailTo} (id ${id}). Not in your inbox? Check spam and resend.com/emails.`)
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setSending(false)
    }
  }

  let equivalent = ''
  if (draft.threshold.unit === 'USD' && rate) equivalent = `≈ ${formatCop(draft.threshold.value * rate)}`
  if (draft.threshold.unit === 'COP' && rate) equivalent = `≈ ${formatUsd(draft.threshold.value / rate)}`
  if (draft.threshold.unit === 'COP' && !rate) equivalent = 'Needs an exchange rate'

  return (
    <div className="settings">
      <section className="card row between">
        <div>
          <h3>Amazon account</h3>
          <div className="status-line">
            <span className={`dot ${signedIn ? 'on' : 'off'}`} />
            {signedIn
              ? 'Signed in · the app keeps the session between restarts'
              : status?.session === 'captcha'
                ? 'Amazon is asking for a CAPTCHA'
                : 'Not signed in'}
          </div>
        </div>
        <div className="row">
          {signedIn && (
            <button
              className="btn link"
              onClick={() =>
                void window.api.signOut().then(
                  () => notify('Signed out of Amazon.'),
                  (e) => notify(cleanError(e), true)
                )
              }
            >
              Sign out
            </button>
          )}
          <button className="btn" onClick={() => void window.api.openAmazon()}>
            Open Amazon
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Email alerts</h3>
        <p className="sub">Sent with your own Resend account.</p>
        <label className="field-label">Resend API key</label>
        <div className="row">
          <input
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            className="mono"
            placeholder={draft.hasResendKey ? '••••••••••••••••••••  saved (encrypted)' : 're_…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => void saveKey().catch((e) => notify(cleanError(e), true))}
            onKeyDown={(e) => e.key === 'Enter' && void saveKey().catch((err) => notify(cleanError(err), true))}
          />
          <button className="btn" onClick={() => setShowKey(!showKey)} disabled={!key}>
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        {draft.hasResendKey && (
          <button
            className="btn link"
            onClick={() =>
              void window.api.setResendKey(null).then(() => {
                setDraft((d) => ({ ...d, hasResendKey: false }))
                notify('API key removed.')
              })
            }
          >
            Remove saved key
          </button>
        )}
        <label className="field-label">Send alerts to</label>
        <input
          type="email"
          style={{ maxWidth: 380 }}
          placeholder="you@example.com"
          value={draft.emailTo}
          onChange={(e) => save({ emailTo: e.target.value }, 800)}
        />
        <label className="field-label">From</label>
        <input type="text" value={draft.emailFrom} onChange={(e) => save({ emailFrom: e.target.value }, 800)} />
        <p className="hint">Without a verified domain in Resend, keep onboarding@resend.dev and send to the email you signed up with.</p>
        <div style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={() => void sendTest()} disabled={sending}>
            {sending ? 'Sending…' : 'Send test email'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <div>
            <h3>Telegram alerts</h3>
            <p className="sub">Get the same alerts in a Telegram chat with your own bot.</p>
          </div>
          <Toggle
            on={draft.telegramEnabled}
            onChange={(v) => save({ telegramEnabled: v })}
            label="Telegram alerts"
          />
        </div>
        <ol className="steps">
          <li>
            In Telegram, open <b>@BotFather</b>, send <code>/newbot</code> and copy the token it gives you.
          </li>
          <li>Paste the token here.</li>
          <li>
            Open your new bot, send <code>/start</code>, then click <b>Detect chat</b>.
          </li>
        </ol>
        <label className="field-label">Bot token</label>
        <div className="row">
          <input
            type="password"
            autoComplete="off"
            className="mono"
            placeholder={draft.hasTelegramToken ? '••••••••••••••••••••  saved (encrypted)' : '123456789:AA…'}
            value={tgToken}
            onChange={(e) => setTgToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && tgToken && void saveTgToken()}
          />
          <button className="btn" onClick={() => void saveTgToken()} disabled={!tgToken || tgBusy}>
            Save
          </button>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void detectChat()} disabled={!draft.hasTelegramToken || tgBusy}>
            Detect chat
          </button>
          <button
            className="btn primary"
            onClick={() => void tg(async () => (await window.api.sendTelegramTest(), 'Test message sent to Telegram.'))}
            disabled={!draft.telegramChatId || tgBusy}
          >
            Send test message
          </button>
          {draft.hasTelegramToken && (
            <button
              className="btn link"
              onClick={() =>
                void tg(async () => {
                  await window.api.setTelegramToken(null)
                  save({ telegramChatId: null, telegramEnabled: false })
                  setDraft((d) => ({ ...d, hasTelegramToken: false, telegramChatId: null, telegramEnabled: false }))
                  return 'Telegram disconnected.'
                })
              }
            >
              Disconnect
            </button>
          )}
        </div>
        <p className="hint">{draft.telegramChatId ? `Chat connected (id ${draft.telegramChatId}).` : 'No chat connected yet.'}</p>
      </section>

      <section className="card">
        <h3>Global alert threshold</h3>
        <p className="sub">Applies to products without their own threshold.</p>
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
        <h3>Check frequency</h3>
        <div style={{ marginTop: 14 }}>
          <Segmented options={INTERVALS} value={String(draft.intervalMinutes)} onChange={(v) => save({ intervalMinutes: Number(v) })} />
        </div>
        <p className="hint">Minimum 15 minutes between checks.</p>
      </section>

      <section className="card">
        <div className="row between">
          <div>
            <h3>Display currency</h3>
            <p className="sub">Prices are tracked in USD; COP is converted with the rate below.</p>
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
            {draft.manualRate ? 'manual' : (status?.exchangeRate?.source ?? 'open.er-api.com')}
          </span>
          <button
            className="btn link"
            onClick={() =>
              void window.api.refreshRate().then(
                () => notify('Exchange rate updated.'),
                (e) => notify(cleanError(e), true)
              )
            }
          >
            Refresh
          </button>
        </div>
        <label className="field-label">Manual rate (optional, overrides the fetched one)</label>
        <input
          className="short mono"
          type="number"
          min={0}
          placeholder="e.g. 4100"
          value={draft.manualRate ?? ''}
          onChange={(e) => save({ manualRate: e.target.value ? Number(e.target.value) : null }, 800)}
        />
        <p className="hint">Amazon doesn't publish the rate it uses, so COP amounts are a close estimate.</p>
      </section>

      <section className="card">
        <h3>App</h3>
        <div className="toggle-row" style={{ marginTop: 8 }}>
          <div>
            <strong>Windows notifications</strong>
            <small>Also show alerts as desktop notifications.</small>
          </div>
          <Toggle on={draft.desktopNotifications} onChange={(v) => save({ desktopNotifications: v })} label="Windows notifications" />
        </div>
        <div className="toggle-row">
          <div>
            <strong>Start with Windows</strong>
            <small>Opens minimized in the tray when you sign in to Windows.</small>
          </div>
          <Toggle on={draft.launchAtStartup} onChange={(v) => save({ launchAtStartup: v })} label="Start with Windows" />
        </div>
      </section>
    </div>
  )
}
