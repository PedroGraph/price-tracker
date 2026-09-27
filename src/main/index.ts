import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import type { Settings, Threshold } from '@shared/types'
import * as db from './db'
import { cachedRate, refreshRate } from './exchange'
import { sendTestEmail } from './notify'
import { clearAmazonSession, flushAmazonSession, openAmazonWindow } from './scraper/amazon'
import { getSettings, saveSettings, setResendKey } from './settings'
import { events, runCheck, schedule, status } from './tracker'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => showWindow())

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

function createTray(): void {
  // 16x16 orange dot drawn in BGRA; replace with resources/icon.ico for a real icon.
  const size = 16
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 7.5 ** 2
      pixels.set(inside ? [0x00, 0x99, 0xff, 0xff] : [0, 0, 0, 0], (y * size + x) * 4)
    }
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size })
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

function registerIpc(): void {
  ipcMain.handle('products:list', () => db.listProducts())
  ipcMain.handle('products:stats', () => db.getStats())
  ipcMain.handle('products:history', (_e, asin: string) => db.getHistory(asin))
  ipcMain.handle('products:events', (_e, asin: string) => db.getEvents(asin))
  ipcMain.handle('products:options', (_e, asin: string, opts: { trackOffers?: boolean; threshold?: Threshold | null }) =>
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

  events.on('status', (s) => win?.webContents.send('status', { ...s, exchangeRate: cachedRate() }))
}

app.whenReady().then(async () => {
  db.openDb()
  registerIpc()
  createWindow()
  createTray()
  status.exchangeRate = (await refreshRate()) ?? cachedRate()
  void runCheck().finally(schedule)
})

app.on('before-quit', () => {
  quitting = true
  flushAmazonSession()
})
// Stay alive in the tray when all windows are closed.
app.on('window-all-closed', () => undefined)
