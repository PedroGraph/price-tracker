import { useEffect, useState } from 'react'
import type { RunRecord, Status } from '@shared/types'
import type { Notify } from '../App'
import { useT } from '../i18n'

const OUTCOME: Record<RunRecord['outcome'], string> = {
  ok: 'OK',
  broken: 'Page not readable',
  session: 'Signed out',
  error: 'Error'
}

/** Recent checks, and a report to paste when something goes wrong. */
export function Diagnostics({ status, notify }: { status: Status | null; notify: Notify }) {
  const { t, locale } = useT()
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) void window.api.listRuns().then(setRuns)
  }, [open, status?.lastRunAt])

  return (
    <section className="card">
      <div className="row between">
        <div>
          <h3>{t('Diagnostics')}</h3>
          <p className="sub">{t('The latest checks. The report has no email, keys or Telegram chat.')}</p>
        </div>
        <div className="row">
          <button className="btn link" onClick={() => setOpen(!open)}>
            {open ? t('Hide') : t('Show')}
          </button>
          <button
            className="btn"
            onClick={() => void window.api.copyDiagnostics().then(() => notify(t('Report copied. Paste it wherever you need it.')))}
          >
            {t('Copy report')}
          </button>
        </div>
      </div>
      {open && (
        <table className="readings" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>{t('Checked')}</th>
              <th>{t('Result')}</th>
              <th className="num">{t('Products')}</th>
              <th className="num">{t('Alerts')}</th>
              <th className="num">{t('Time')}</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t('Nothing yet.')}
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr key={r.id} title={r.message ?? ''}>
                <td>{new Date(r.startedAt).toLocaleString(locale)}</td>
                <td className={r.outcome === 'ok' ? 'ok-text' : 'bad-text'}>
                  {t(OUTCOME[r.outcome])}
                  {r.message && <small className="muted"> · {r.message.slice(0, 60)}</small>}
                </td>
                <td className="num">
                  {r.checked}
                  {r.unreadable ? ` (${r.unreadable} ✗)` : ''}
                </td>
                <td className="num">{r.alerts}</td>
                <td className="num">{Math.round(r.durationMs / 1000)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
