import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Strict Content Security Policy for the built app. Only added to production builds:
 * the dev server needs an inline script for hot reload, and only serves local code.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' https://*.media-amazon.com https://*.ssl-images-amazon.com data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), csp()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
