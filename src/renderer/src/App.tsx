import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Notifications } from './Notifications'
import { ChevronLeft, Moon, RefreshCw, Settings as Gear, Sun, TrendingUp } from 'lucide-react'
import type { DashboardStats, Product, Settings, Status } from '@shared/types'
import { LangContext, useT } from './i18n'
import { MoneyContext, type DisplayCurrency } from './money'
import { timeAgo, timeUntil } from './ui'
import { Dashboard } from './views/Dashboard'
// Loaded when first opened, so the dashboard shows up without the chart and settings code.
const ProductDetail = lazy(() => import('./views/ProductDetail').then((m) => ({ default: m.ProductDetail })))
const SettingsView = lazy(() => import('./views/Settings').then((m) => ({ default: m.SettingsView })))

type View = { name: 'dashboard' } | { name: 'product'; asin: string } | { name: 'settings' }
type Theme = 'light' | 'dark'
export type Notify = (text: string, error?: boolean) => void

// Per-viewer conveniences only; the app works without storage.
function load<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  return (
    <LangContext.Provider value={settings?.language ?? 'en'}>
      <Shell settings={settings} setSettings={setSettings} />
    </LangContext.Provider>
  )
}

function Shell({ settings, setSettings }: { settings: Settings | null; setSettings: (s: Settings) => void }) {
  const { t } = useT()
  const [view, setView] = useState<View>({ name: 'dashboard' })
  const [status, setStatus] = useState<Status | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [currency, setCurrencyState] = useState<DisplayCurrency>(() => load('currency', 'USD'))
  const [theme, setTheme] = useState<Theme>(() =>
    load('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const [, tick] = useState(0)

  const reload = useCallback(async () => {
    const [p, s] = await Promise.all([window.api.listProducts(), window.api.getStats()])
    setProducts(p)
    setStats(s)
  }, [])

  useEffect(() => {
    void reload()
    void window.api.getStatus().then(setStatus)
    void window.api.getSettings().then(setSettings)
    const off = window.api.onStatus((s) => {
      setStatus(s)
      void reload()
      void window.api.getSettings().then(setSettings)
    })
    // A Windows notification was clicked: show that product.
    const offOpen = window.api.onOpenProduct((asin) => setView({ name: 'product', asin }))
    // Keeps the "x min ago" labels fresh.
    const t = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => {
      off()
      offOpen()
      clearInterval(t)
    }
  }, [reload, setSettings])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    store('theme', theme)
  }, [theme])

  const setCurrency = (c: DisplayCurrency): void => {
    setCurrencyState(c)
    store('currency', c)
  }

  const notify: Notify = (text, error) => {
    setToast({ text, error })
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 7000 : 3500)
  }

  const rate = status?.exchangeRate?.rate ?? null
  const signedOut = status?.session === 'logged_out' || status?.session === 'captcha'
  const themeButton = (
    <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('Toggle theme')}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
  const back = (
    <button className="btn" onClick={() => setView({ name: 'dashboard' })}>
      <ChevronLeft size={16} /> {t('Dashboard')}
    </button>
  )

  return (
    <MoneyContext.Provider value={{ currency, rate, setCurrency }}>
      <header className="topbar">
        {view.name === 'dashboard' ? (
          <>
            <div className="brand">
              <div className="logo">
                <TrendingUp size={22} />
              </div>
              <div>
                <h1>{t('Price Tracker')}</h1>
                {signedOut ? (
                  <p className="warn">{t('Not connected to Amazon')}</p>
                ) : (
                  <p>{t('Connected to your Amazon cart · runs in the tray')}</p>
                )}
              </div>
            </div>
            <div className="spacer" />
            <div className="sync">
              <button onClick={() => void window.api.runNow()} disabled={status?.running} title={t('Check now')}>
                <RefreshCw size={15} className={status?.running ? 'spin' : ''} />
                {status?.running ? t('Checking…') : t('Updated {when}', { when: timeAgo(status?.lastRunAt ?? null, t) })}
              </button>
              <span className="sep" />
              <span>{t('Next check in {time}', { time: timeUntil(status?.nextRunAt ?? null) })}</span>
            </div>
            <Notifications
              status={status}
              onOpen={(asin) => setView({ name: 'product', asin })}
              onTrack={async (asin) => {
                try {
                  await window.api.addProduct(asin)
                  notify(t('Tracking {asin}. Its price appears after this check.', { asin }))
                } catch (e) {
                  notify(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), true)
                  throw e
                }
              }}
            />
            {themeButton}
            <button className="icon-btn" onClick={() => setView({ name: 'settings' })} aria-label={t('Settings')}>
              <Gear size={18} />
            </button>
          </>
        ) : (
          <>
            {back}
            <span className={view.name === 'settings' ? 'crumb strong' : 'crumb'}>
              {view.name === 'settings' ? t('Settings') : t('Product details')}
            </span>
            <div className="spacer" />
            {themeButton}
          </>
        )}
      </header>

      {signedOut && (
        <div className="banner">
          <span>
            {status?.session === 'captcha'
              ? t('Amazon is asking for a CAPTCHA. Open Amazon, solve it, and close the window.')
              : t('Sign in to Amazon so the app can read your cart. Close the window when you are done.')}
          </span>
          <button className="btn" onClick={() => void window.api.openAmazon()}>
            {t('Open Amazon')}
          </button>
        </div>
      )}
      {status?.update.status === 'ready' && (
        <div className="banner info">
          <span>{t('Version {version} is ready to install.', { version: status.update.version ?? '' })}</span>
          <button className="btn primary" onClick={() => void window.api.installUpdate()}>
            {t('Restart to update')}
          </button>
        </div>
      )}
      {status?.lastError && !signedOut && (
        <div className="banner">
          <span>{status.lastError}</span>
        </div>
      )}

      <main>
        <Suspense fallback={null}>
        {view.name === 'dashboard' && (
          <Dashboard
            products={products}
            stats={stats}
            status={status}
            onOpen={(asin) => setView({ name: 'product', asin })}
            notify={notify}
          />
        )}
        {view.name === 'product' && settings && (
          <ProductDetail
            product={products.find((p) => p.asin === view.asin)}
            globalThreshold={settings.threshold}
            onChanged={reload}
            notify={notify}
            onRemoved={() => {
              void reload()
              setView({ name: 'dashboard' })
            }}
          />
        )}
        {view.name === 'settings' && settings && (
          <SettingsView settings={settings} status={status} onSaved={setSettings} notify={notify} />
        )}
        </Suspense>
      </main>

      {toast && <div className={toast.error ? 'toast error' : 'toast'}>{toast.text}</div>}
    </MoneyContext.Provider>
  )
}
