import { contextBridge, ipcRenderer } from 'electron'
import type { RunRecord, DashboardStats, ExchangeRate, PriceReading, Product, Settings, Status, Threshold, TrackerEvent } from '@shared/types'

/** The only surface the UI can reach. Each method maps to one IPC channel. */
const api = {
  listProducts: (): Promise<Product[]> => ipcRenderer.invoke('products:list'),
  getStats: (): Promise<DashboardStats> => ipcRenderer.invoke('products:stats'),
  addProduct: (urlOrAsin: string): Promise<string> => ipcRenderer.invoke('products:add', urlOrAsin),
  removeProduct: (asin: string): Promise<void> => ipcRenderer.invoke('products:remove', asin),
  /** Opens a save dialog; resolves to the saved path or null when cancelled. */
  exportCsv: (asin?: string): Promise<string | null> => ipcRenderer.invoke('products:export', asin),
  getHistory: (asin: string): Promise<PriceReading[]> => ipcRenderer.invoke('products:history', asin),
  getEvents: (asin: string): Promise<TrackerEvent[]> => ipcRenderer.invoke('products:events', asin),
  setProductOptions: (
    asin: string,
    opts: { trackOffers?: boolean; threshold?: Threshold | null; targetPrice?: number | null }
  ): Promise<void> =>
    ipcRenderer.invoke('products:options', asin, opts),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:save', patch),
  setResendKey: (key: string | null): Promise<void> => ipcRenderer.invoke('settings:resendKey', key),
  sendTestEmail: (): Promise<string> => ipcRenderer.invoke('email:test'),
  /** Validates and stores the bot token; resolves to the bot's @username. */
  setTelegramToken: (token: string | null): Promise<string | void> => ipcRenderer.invoke('telegram:token', token),
  detectTelegramChat: (): Promise<string> => ipcRenderer.invoke('telegram:detect'),
  sendTelegramTest: (): Promise<void> => ipcRenderer.invoke('telegram:test'),
  getStatus: (): Promise<Status> => ipcRenderer.invoke('status:get'),
  refreshRate: (): Promise<ExchangeRate | null> => ipcRenderer.invoke('rate:refresh'),
  openAmazon: (): Promise<void> => ipcRenderer.invoke('amazon:login'),
  signOut: (): Promise<void> => ipcRenderer.invoke('amazon:logout'),
  runNow: (): Promise<void> => ipcRenderer.invoke('tracker:run'),
  listRuns: (): Promise<RunRecord[]> => ipcRenderer.invoke('diagnostics:runs'),
  copyDiagnostics: (): Promise<void> => ipcRenderer.invoke('diagnostics:copy'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onStatus: (cb: (s: Status) => void): (() => void) => {
    const listener = (_e: unknown, s: Status): void => cb(s)
    ipcRenderer.on('status', listener)
    return () => ipcRenderer.removeListener('status', listener)
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
