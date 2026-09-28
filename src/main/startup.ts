import { app } from 'electron'

/** Startup timings (ms since the process started), shown in the diagnostics report. */
export const startup: Record<string, number> = {}

export function mark(name: string): void {
  startup[name] = Math.round(process.uptime() * 1000)
  if (!app.isPackaged) console.log(`[startup] ${name}: ${startup[name]} ms`)
}
