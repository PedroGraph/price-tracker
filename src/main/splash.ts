import { BrowserWindow, nativeTheme } from 'electron'

/**
 * The small loading window shown while the app opens, like Discord's: the logo with a
 * price line drawing itself. A self-contained page (inline SVG and CSS, no scripts).
 */
const MIN_VISIBLE_MS = 1200

function page(dark: boolean): string {
  const bg = dark ? '#121412' : '#f5f4f0'
  const text = dark ? '#ecebe6' : '#1c1c1a'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; -webkit-app-region: drag; }
  .card { position: absolute; inset: 10px; border-radius: 22px; background: ${bg}; box-shadow: 0 10px 30px rgba(0,0,0,.35);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
          font-family: 'Segoe UI', system-ui, sans-serif; }
  .logo { width: 84px; height: 84px; border-radius: 22px; background: linear-gradient(145deg, #1aa392, #0e8a7b);
          display: grid; place-items: center; animation: breathe 1.6s ease-in-out infinite; }
  .logo path { stroke-dasharray: 60; stroke-dashoffset: 60; animation: draw 1.6s ease-in-out infinite; }
  h1 { margin: 0; font-size: 19px; font-weight: 700; color: ${text}; letter-spacing: .2px; }
  .bar { width: 120px; height: 4px; border-radius: 4px; background: ${dark ? '#2d322f' : '#e6e4dd'}; overflow: hidden; }
  .bar i { display: block; width: 40%; height: 100%; border-radius: 4px; background: #1aa392; animation: slide 1.1s ease-in-out infinite; }
  @keyframes breathe { 50% { transform: scale(1.06); } }
  @keyframes draw { 0% { stroke-dashoffset: 60; } 55%, 100% { stroke-dashoffset: 0; } }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
</style></head><body><div class="card">
  <div class="logo"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg></div>
  <h1>Price Tracker</h1>
  <div class="bar"><i></i></div>
</div></body></html>`
}

export interface Splash {
  /** Closes the splash (after it has been visible a moment) and runs `show` right before. */
  done: (show: () => void) => void
}

export function showSplash(): Splash {
  const dark = nativeTheme.shouldUseDarkColors
  const shownAt = Date.now()
  const splash = new BrowserWindow({
    width: 300,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    center: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  })
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(dark))}`)
  splash.once('ready-to-show', () => splash.show())
  return {
    done: (show) => {
      setTimeout(() => {
        show()
        if (!splash.isDestroyed()) splash.destroy()
      }, Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt)))
    }
  }
}
