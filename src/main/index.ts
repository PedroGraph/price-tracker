import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toCsv } from '@shared/csv'
import { parseAsin } from '@shared/pricing'
import type { Settings, Threshold } from '@shared/types'
import * as db from './db'
import { maybeSendDigest } from './digest'
import { cachedRate, currentRate, refreshRate } from './exchange'
import { flushQueuedAlerts, sendTestEmail } from './notify'
import { clearAmazonSession, flushAmazonSession, openAmazonWindow } from './scraper/amazon'
import { getSettings, saveSettings, setResendKey, setSecret } from './settings'
import { botName, detectChat, sendTelegramTest } from './notify/telegram'
import { events, runCheck, schedule, status } from './tracker'
import { checkForUpdates, initUpdater, installUpdate, update } from './updater'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

if (!app.requestSingleInstanceLock()) app.quit()
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'Amazon Price Tracker',
    icon: resourceImage('icon.png') ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  if (!process.argv.includes('--hidden')) win.once('ready-to-show', () => win?.show())

  // Closing the window keeps the tracker running in the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => (win = null))

  // External links open in the default browser; the UI itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
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
  tray.setToolTip('Amazon Price Tracker')
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

/** Accepts a bare ASIN, a product URL, or a short amzn.to / a.co link (followed to the product page). */
async function resolveAsin(input: string): Promise<string | null> {
  const direct = parseAsin(input)
  if (direct) return direct
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (!/^(amzn\.to|a\.co|amzn\.com|www\.amazon\.com|amazon\.com)$/i.test(url.hostname)) return null
  const res = await fetch(url, { method: 'GET', redirect: 'follow' })
  return parseAsin(res.url)
}

function registerIpc(): void {
  ipcMain.handle('products:list', () => db.listProducts())
  ipcMain.handle('products:stats', () => db.getStats())
  ipcMain.handle('products:add', async (_e, input: string) => {
    const asin = await resolveAsin(input)
    if (!asin) throw new Error("That doesn't look like an Amazon product link or ASIN.")
    db.addManualProduct(asin)
    events.emit('status', { ...status })
    void runCheck()
    return asin
  })
  // Asks where to save, then writes the price history as CSV. Resolves to the path, or null if cancelled.
  ipcMain.handle('products:export', async (_e, asin?: string) => {
    const name = asin ? `price-history-${asin}` : 'price-history'
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Export price history',
      defaultPath: join(app.getPath('downloads'), `${name}-${new Date().toISOString().slice(0, 10)}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return null
    const columns = ['asin', 'title', 'checked_at', 'source', 'seller', 'condition', 'price_usd', 'shipping_usd', 'available']
    // BOM so Excel opens accents (e.g. Spanish titles) correctly.
    await writeFile(filePath, '\ufeff' + toCsv(db.exportRows(asin), columns), 'utf8')
    return filePath
  })
  ipcMain.handle('products:remove', (_e, asin: string) => {
    db.deactivateProduct(asin)
    events.emit('status', { ...status })
  })
  ipcMain.handle('products:history', (_e, asin: string) => db.getHistory(asin))
  ipcMain.handle('products:events', (_e, asin: string) => db.getEvents(asin))
  ipcMain.handle('products:options', (_e, asin: string, opts: { trackOffers?: boolean; threshold?: Threshold | null; targetPrice?: number | null }) =>
    db.setProductOptions(asin, opts)
  )
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const saved = saveSettings(patch)
    schedule()
    return saved
  })
  ipcMain.handle('settings:resendKey', (_e, key: string | null) => setResendKey(key))
  ipcMain.handle('email:test', () => sendTestEmail())
  // The token is checked with Telegram before it's stored, and only the bot name goes back to the UI.
  ipcMain.handle('telegram:token', async (_e, token: string | null) => {
    if (!token) return setSecret('telegramToken', null)
    const name = await botName(token.trim())
    setSecret('telegramToken', token)
    return name
  })
  ipcMain.handle('telegram:detect', async () => {
    const chat = await detectChat()
    saveSettings({ telegramChatId: chat.id, telegramEnabled: true })
    return chat.label
  })
  ipcMain.handle('telegram:test', () => sendTelegramTest())
  ipcMain.handle('status:get', () => ({ ...status, exchangeRate: cachedRate() }))
  ipcMain.handle('rate:refresh', async () => {
    status.exchangeRate = (await refreshRate(true)) ?? cachedRate()
    return status.exchangeRate
  })
  ipcMain.handle('amazon:login', async () => {
    await openAmazonWindow(win ?? undefined)
    void runCheck()
  })
  ipcMain.handle('amazon:logout', async () => {
    await clearAmazonSession()
    status.session = 'logged_out'
  })
  ipcMain.handle('tracker:run', () => runCheck())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => {
    quitting = true
    installUpdate()
  })

  events.on('status', (s) => win?.webContents.send('status', { ...s, exchangeRate: cachedRate() }))
}

app.whenReady().then(async () => {
  db.openDb()
  registerIpc()
  createWindow()
  createTray()
  status.exchangeRate = (await refreshRate()) ?? cachedRate()
  void runCheck().finally(schedule)
  initUpdater(() => {
    status.update = { ...update }
    events.emit('status', { ...status })
  })
  // Housekeeping between checks: send alerts held during quiet hours once they end.
  // and send the daily/weekly summary at its hour.
  setInterval(() => {
    void flushQueuedAlerts(currentRate()).catch(() => undefined)
    void maybeSendDigest(currentRate()).catch(() => undefined)
  }, 5 * 60_000)
})

app.on('before-quit', () => {
  quitting = true
  flushAmazonSession()
})
// Stay alive in the tray when all windows are closed.
app.on('window-all-closed', () => undefined)
