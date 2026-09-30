import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Menu, nativeImage, session, Tray, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toCsv } from '@shared/csv'
import type { SearchParams, Settings, Threshold } from '@shared/types'
import { searchUrl } from '@shared/urls'
import { dismissSuggestion, listSuggestions, refreshSuggestions } from './suggestions'
import * as db from './db'
import { maybeSendDigest } from './digest'
import { maybeSendSaleHeadsUp, saleOutlook } from './sales'
import { maybeSendTrmAlert, refreshTrm } from './trm'
import { compareProduct, getComparison, openMercadoLibreLogin } from './stores'
import { getRadar, refreshRadar } from './radar'
import { diagnosticsReport } from './diagnostics'
import { inspectBackup, restoreBackup, writeBackup } from './backup'
import { cachedRate, currentRate, refreshRate } from './exchange'
import { flushQueuedAlerts, onNotificationClick, sendTestEmail } from './notify'
import { APP_URL, registerAppScheme, serveRenderer } from './appProtocol'
import { mark } from './startup'
import { showSplash } from './splash'
import { amazonSession, clearAmazonSession, flushAmazonSession, openAmazonWindow, Scraper } from './scraper/amazon'
import { denyPermissions, installGlobalGuards, isTrustedSender, openExternal, reencryptCookies } from './security'
import { getSettings, saveSettings, setResendKey, setSecret } from './settings'
import { botName, sendTelegramTest } from './notify/telegram'
import { detectChatWhilePaused, syncBot } from './notify/telegramBot'
import { resolveAsin } from './resolveAsin'
import { events, runCheck, schedule, status } from './tracker'
import { checkForUpdates, initUpdater, installUpdate, update } from './updater'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// Data lives in %APPDATA%/amazon-price-tracker no matter what the app is called, so renaming
// the product never moves (or loses) the database and the Amazon session. Development runs
// use their own folder: the installed app encrypts its cookies and a dev build can't read them.
app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? 'amazon-price-tracker' : 'amazon-price-tracker-dev'))
// Chromium debugging switches would let another program read the pages and the Amazon
// cookies of the installed app (there's no fuse for these), so refuse to start with them.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'inspect', 'inspect-brk']
if (app.isPackaged && DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1)
}

installGlobalGuards()
registerAppScheme()

// `--quit` with no running instance to tell has nothing to do.
if (!app.requestSingleInstanceLock() || process.argv.includes('--quit')) app.quit()
// `electron . --quit` asks the running instance to exit cleanly (cookies flushed to disk).
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--quit')) {
    quitting = true
    app.quit()
  } else showWindow()
})

function showWindow(): void {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Window buttons (minimize, maximize, close) in the app's colors. */
function overlayColors(dark: boolean): Electron.TitleBarOverlayOptions {
  return dark ? { color: '#121412', symbolColor: '#ecebe6', height: 40 } : { color: '#f5f4f0', symbolColor: '#1c1c1a', height: 40 }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    show: false,
    // Paint the app's background right away instead of a white window while the page loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121412' : '#f5f4f0',
    title: 'Price Tracker',
    icon: resourceImage('icon.png') ?? undefined,
    // No Windows title bar: the app's own header is the bar, with the window buttons drawn over it.
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(nativeTheme.shouldUseDarkColors),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })
  // Stay in the tray when started with --hidden (Windows start-up) or after a background update.
  const relaunchHidden = db.getSetting<boolean>('relaunchHidden', false)
  if (relaunchHidden) db.setSetting('relaunchHidden', false)
  win.once('ready-to-show', () => mark('windowReady'))
  win.webContents.once('did-finish-load', () => mark('pageLoaded'))
  // Opened by the user: a small loading window until the page is ready, then the app.
  if (!process.argv.includes('--hidden') && !relaunchHidden) {
    const splash = showSplash()
    win.once('ready-to-show', () => splash.done(() => win?.show()))
  }

  // Closing the window keeps the tracker running in the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => (win = null))

  // Links to known sites (Amazon, GitHub…) open in the browser; the UI itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadURL(APP_URL)
}

/** resources/<name> next to the app (packaged: copied via extraResources), or null if it isn't there. */
function resourceImage(name: string): Electron.NativeImage | null {
  const file = app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
  if (!existsSync(file)) return null
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? null : image
}

function createTray(): void {
  // Your icon from resources/tray.png, or a 16x16 orange dot drawn in BGRA as a placeholder.
  const custom = resourceImage('tray.png')
  if (custom) return setupTray(custom)
  const size = 16
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 7.5 ** 2
      pixels.set(inside ? [0x00, 0x99, 0xff, 0xff] : [0, 0, 0, 0], (y * size + x) * 4)
    }
  }
  setupTray(nativeImage.createFromBitmap(pixels, { width: size, height: size }))
}

function setupTray(icon: Electron.NativeImage): void {
  tray = new Tray(icon)
  tray.setToolTip('Price Tracker')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { label: 'Check now', click: () => void runCheck() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

/** ipcMain.handle, but only for calls coming from the app's own page. */
function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Blocked IPC call from an untrusted page.')
    return fn(event, ...args)
  })
}

function registerIpc(): void {
  handle('products:list', () => db.listProducts())
  handle('products:stats', () => db.getStats())
  handle('products:add', async (_e, input: string) => {
    const asin = await resolveAsin(input)
    if (!asin) throw new Error("That doesn't look like an Amazon product link or ASIN.")
    db.addManualProduct(asin)
    events.emit('status', { ...status })
    void runCheck()
    return asin
  })
  // Asks where to save, then writes the price history as CSV. Resolves to the path, or null if cancelled.
  handle('products:export', async (_e, asin?: string) => {
    const name = asin ? `price-history-${asin}` : 'price-history'
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Export price history',
      defaultPath: join(app.getPath('downloads'), `${name}-${new Date().toISOString().slice(0, 10)}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return null
    const columns = ['asin', 'title', 'checked_at', 'source', 'seller', 'seller_id', 'condition', 'price_usd', 'shipping_usd', 'available']
    // BOM so Excel opens accents (e.g. Spanish titles) correctly.
    await writeFile(filePath, '\ufeff' + toCsv(db.exportRows(asin), columns), 'utf8')
    return filePath
  })
  handle('products:remove', (_e, asin: string) => {
    db.deactivateProduct(asin)
    events.emit('status', { ...status })
  })
  handle('products:history', (_e, asin: string) => db.getHistory(asin))
  handle('products:events', (_e, asin: string) => db.getEvents(asin))
  handle('products:options', (_e, asin: string, opts: { trackOffers?: boolean; threshold?: Threshold | null; targetPrice?: number | null; tags?: string[] }) =>
    db.setProductOptions(asin, opts)
  )
  handle('settings:get', () => getSettings())
  handle('settings:save', (_e, patch: Partial<Settings>) => {
    const saved = saveSettings(patch)
    schedule()
    syncBot()
    return saved
  })
  handle('settings:resendKey', (_e, key: string | null) => setResendKey(key))
  handle('email:test', () => sendTestEmail())
  // The token is checked with Telegram before it's stored, and only the bot name goes back to the UI.
  handle('telegram:token', async (_e, token: string | null) => {
    if (!token) {
      setSecret('telegramToken', null)
      return syncBot()
    }
    const name = await botName(token.trim())
    setSecret('telegramToken', token)
    return name
  })
  handle('telegram:detect', async () => {
    const chat = await detectChatWhilePaused()
    saveSettings({ telegramChatId: chat.id, telegramEnabled: true })
    syncBot()
    return chat.label
  })
  handle('telegram:test', () => sendTelegramTest())
  handle('status:get', () => ({ ...status, exchangeRate: cachedRate() }))
  handle('rate:refresh', async () => {
    status.exchangeRate = (await refreshRate(true)) ?? cachedRate()
    return status.exchangeRate
  })
  handle('amazon:login', async () => {
    await openAmazonWindow(win ?? undefined)
    void runCheck()
  })
  // Search runs in its own hidden window, so it works while a check is running.
  handle('amazon:search', async (_e, params: SearchParams) => {
    const url = params && typeof params === 'object' ? searchUrl(params) : null
    if (!url) throw new Error('Invalid search.')
    const scraper = new Scraper()
    try {
      return await scraper.search(url, currentRate())
    } finally {
      scraper.close()
    }
  })
  // A product page, to add it to the cart or look closer; anything added gets tracked on the next check.
  handle('amazon:product', async (_e, asin: unknown) => {
    if (typeof asin !== 'string' || !/^[A-Z0-9]{10}$/.test(asin)) throw new Error('Invalid ASIN.')
    await openAmazonWindow(win ?? undefined, asin)
    void runCheck()
  })
  handle('notifications:list', () => ({ alerts: db.listRecentAlerts(), seenAt: db.getSetting<string | null>('alertsSeenAt', null) }))
  handle('notifications:seen', () => db.setSetting('alertsSeenAt', new Date().toISOString()))
  handle('window:theme', (_e, dark: unknown) => {
    if (process.platform === 'win32') win?.setTitleBarOverlay(overlayColors(dark === true))
  })
  handle('products:reviews', (_e, asin: unknown) => (typeof asin === 'string' ? db.getReviews(asin) : null))
  handle('products:purchase', (_e, asin: unknown, p: unknown) => {
    if (typeof asin !== 'string') return
    if (p === null) return db.setPurchase(asin, null)
    const x = p as { at?: unknown; price?: unknown; returnUntil?: unknown }
    const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    if (!date(x.at) || !date(x.returnUntil) || typeof x.price !== 'number' || !(x.price > 0)) throw new Error('Invalid purchase.')
    db.setPurchase(asin, { at: x.at, price: Math.round(x.price * 100) / 100, returnUntil: x.returnUntil })
  })
  handle('trm:get', () => refreshTrm())
  handle('radar:get', () => getRadar())
  handle('radar:refresh', async () => {
    await refreshRadar(true)
    return getRadar()
  })
  handle('compare:get', (_e, asin: unknown) => (typeof asin === 'string' ? getComparison(asin) : null))
  handle('compare:run', (_e, asin: unknown) => {
    if (typeof asin !== 'string' || !/^[A-Z0-9]{10}$/.test(asin)) throw new Error('Invalid ASIN.')
    return compareProduct(asin)
  })
  handle('stores:mlLogin', () => openMercadoLibreLogin(win ?? undefined))
  handle('sales:outlook', () => saleOutlook())
  handle('stats:products', () => db.productStats())
  handle('stats:series', (_e, asins: unknown) =>
    Array.isArray(asins)
      ? asins.filter((a): a is string => typeof a === 'string').slice(0, 5).map((asin) => ({ asin, points: db.priceSeries(asin) }))
      : []
  )
  handle('suggestions:list', () => listSuggestions())
  handle('suggestions:dismiss', (_e, asin: unknown) => {
    if (typeof asin === 'string' && /^[A-Z0-9]{10}$/.test(asin)) dismissSuggestion(asin)
  })
  handle('suggestions:refresh', async () => {
    await refreshSuggestions(true)
    return listSuggestions()
  })
  handle('amazon:logout', async () => {
    await clearAmazonSession()
    status.session = 'logged_out'
  })
  handle('tracker:run', () => runCheck())
  handle('diagnostics:runs', () => db.listRuns(30))

  // Backups: the page never sees or passes file paths; they stay in the main process.
  handle('backup:create', async (_e, opts: { includeKeys: boolean; password: string | null }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Save backup',
      defaultPath: join(app.getPath('documents'), `price-tracker-backup-${new Date().toISOString().slice(0, 10)}.ptbackup`),
      filters: [{ name: 'Price Tracker backup', extensions: ['ptbackup'] }]
    })
    if (canceled || !filePath) return null
    await writeBackup(filePath, { includeKeys: !!opts.includeKeys, password: opts.password || null })
    return filePath
  })
  let pickedBackup: string | null = null
  handle('backup:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: 'Restore backup',
      filters: [{ name: 'Price Tracker backup', extensions: ['ptbackup'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    pickedBackup = filePaths[0]
    return inspectBackup(pickedBackup)
  })
  handle('backup:restore', async (_e, password: string | null) => {
    if (!pickedBackup) throw new Error('Choose a backup file first.')
    const info = await restoreBackup(pickedBackup, password || null)
    pickedBackup = null
    schedule()
    events.emit('status', { ...status })
    return info
  })
  // Copied from the main process: the page itself has no clipboard permission.
  handle('diagnostics:copy', () => clipboard.writeText(diagnosticsReport()))
  handle('update:check', () => checkForUpdates())
  handle('update:install', () => installUpdate(false))

  events.on('status', (s) => win?.webContents.send('status', { ...s, exchangeRate: cachedRate() }))
}


// Windows shows notifications under this id; it matches the Start menu shortcut the installer creates.
if (process.platform === 'win32') app.setAppUserModelId('com.local.amazonpricetracker')

app.whenReady().then(async () => {
  mark('ready')
  denyPermissions(session.defaultSession)
  denyPermissions(amazonSession())
  // No menu in the installed app: no reload / DevTools shortcuts.
  if (app.isPackaged) Menu.setApplicationMenu(null)
  serveRenderer(join(__dirname, '../renderer'))
  db.openDb()
  // Re-register "start with Windows" so it points at this install (its path changes between versions).
  if (app.isPackaged && getSettings().launchAtStartup) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
  // Once, before the first check: rewrite old plain-text cookies so they're stored encrypted.
  await reencryptCookies(
    amazonSession(),
    () => db.getSetting<boolean>('cookiesReencrypted', false),
    () => db.setSetting('cookiesReencrypted', true)
  ).catch(() => undefined)
  mark('dbOpen')
  registerIpc()
  onNotificationClick((asin) => {
    showWindow()
    const send = (): void => win?.webContents.send('open-product', asin)
    // A window created just now has to load the page before it can listen.
    if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
  })
  createWindow()
  mark('windowCreated')
  createTray()
  // The first check opens Amazon in a hidden browser: let the window settle first.
  const FIRST_CHECK_DELAY = 15_000
  status.nextRunAt = new Date(Date.now() + FIRST_CHECK_DELAY).toISOString()
  setTimeout(() => void runCheck().finally(schedule), FIRST_CHECK_DELAY)
  // Coupons on products related to the cart: every 30 minutes, skipped while a check runs or signed out.
  setInterval(() => {
    if (status.running || status.session !== 'logged_in') return
    void refreshSuggestions()
      .then(() => refreshRadar())
      .then((ran) => ran && events.emit('status', { ...status }))
  }, 30 * 60_000)
  syncBot()
  initUpdater(
    () => {
      status.update = { ...update }
      events.emit('status', { ...status })
    },
    {
      isIdle: () => !status.running && !(win?.isVisible() ?? false),
      beforeInstall: (hidden) => {
        quitting = true
        db.setSetting('relaunchHidden', hidden)
        flushAmazonSession()
      }
    }
  )
  // Housekeeping between checks: send alerts held during quiet hours once they end.
  // and send the daily/weekly summary at its hour.
  setInterval(() => {
    void flushQueuedAlerts(currentRate()).catch(() => undefined)
    void maybeSendDigest(currentRate()).catch(() => undefined)
    void maybeSendSaleHeadsUp().catch(() => undefined)
    void maybeSendTrmAlert().catch(() => undefined)
  }, 5 * 60_000)
})

app.on('before-quit', () => {
  quitting = true
  flushAmazonSession()
})
// Stay alive in the tray when all windows are closed.
app.on('window-all-closed', () => undefined)
