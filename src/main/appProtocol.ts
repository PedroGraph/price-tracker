import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

/**
 * The UI is served from app://renderer/ instead of file://. With the
 * GrantFileProtocolExtraPrivileges fuse off, file:// pages can't load their JS modules,
 * and a custom scheme also keeps the rest of the disk out of the page's reach.
 */
export const APP_ORIGIN = 'app://renderer'
export const APP_URL = `${APP_ORIGIN}/index.html`

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
}

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

/** Serves files from `rendererDir` only; anything outside it (e.g. via ../) is a 404. */
export function serveRenderer(rendererDir: string): void {
  const root = normalize(rendererDir + sep)
  protocol.handle('app', async (request) => {
    const { host, pathname } = new URL(request.url)
    const file = normalize(join(root, decodeURIComponent(pathname)))
    if (host !== 'renderer' || !file.startsWith(root)) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, { headers: { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
