export type ThresholdUnit = 'percent' | 'USD' | 'COP'

export interface Threshold {
  unit: ThresholdUnit
  value: number
}

export interface Product {
  asin: string
  title: string
  url: string
  image: string | null
  active: boolean
  trackOffers: boolean
  /** Reference price in USD. Alerts fire when the current price moves past the threshold from here. */
  basePrice: number | null
  lastPrice: number | null
  /** Shipping cost in USD shown next to the price. Never part of the tracked price. */
  lastShipping: number | null
  /** Seller of the current price (buy box or cheapest offer). */
  lastSeller: string | null
  /** Amazon's id for that seller, for links to their offer. */
  lastSellerId: string | null
  available: boolean | null
  /** Per-product threshold; null means the global one is used. */
  threshold: Threshold | null
  addedAt: string
  lastCheckedAt: string | null
  /** First price ever seen, used for the "was" price on the dashboard. */
  firstPrice: number | null
  /** Recent tracked prices, oldest first, for the sparkline. */
  spark: number[]
  /** Distinct sellers in the last offers check (0 when not tracking sellers). */
  sellerCount: number
  /** When the base price last changed (an alert fired or tracking started). */
  baseSince: string | null
  /** A back_in_stock event in the last 24 hours. */
  backInStock: boolean
  /**
   * Where it comes from: the cart, "Saved for later", a wishlist (these follow Amazon), or
   * 'manual' (added by link, stays until removed).
   */
  source: ProductSource
  /** Alert once when the price drops to this USD amount or below. */
  targetPrice: number | null
  /** Import fees deposit in USD when shipping abroad (e.g. to Colombia). Not part of the tracked price. */
  lastImportFees: number | null
  /** Coupon text shown on the product page, e.g. "Apply $20 coupon". */
  coupon: string | null
  /** Deal badge, e.g. "Limited time deal". */
  deal: string | null
  /** Average tracked price over the last 30 days, the number of checks and how many days they span. */
  avg30: number | null
  runs30: number
  spanDays30: number
  /** Lowest tracked price ever and in the last 30 days. */
  lowestPrice: number | null
  lowest30: number | null
}

/** One tracking run, for the diagnostics list. */
export interface RunRecord {
  id: number
  startedAt: string
  durationMs: number
  outcome: 'ok' | 'broken' | 'session' | 'error'
  message: string | null
  checked: number
  unreadable: number
  alerts: number
}

/** One product from an Amazon search, shown in the app. */
export interface SearchResult {
  asin: string
  title: string
  image: string | null
  price: number | null
  rating: string | null
  reviews: string | null
  sponsored: boolean
}

export interface SearchParams {
  query: string
  /** Amazon's refinement state, as found in the filter links. */
  rh?: string
  sort?: string
  /** Price range in USD. */
  minPrice?: number | null
  maxPrice?: number | null
}

export interface SearchFilter {
  title: string
  options: { label: string; rh: string; selected: boolean }[]
}

export interface SearchPage {
  results: SearchResult[]
  filters: SearchFilter[]
  sorts: { value: string; label: string }[]
  sort: string | null
}

export type ProductSource = 'cart' | 'saved' | 'wishlist' | 'manual'

export interface DashboardStats {
  tracked: number
  droppedCount: number
  /** Sum of drops over the last 7 days, in USD. */
  savedThisWeek: number
  alertsLast30Days: number
}

export interface PriceReading {
  id: number
  asin: string
  price: number | null
  shipping: number | null
  seller: string | null
  sellerId: string | null
  /** Offer condition, e.g. "New" or "Used - Like New". */
  condition: string | null
  source: 'buybox' | 'offer'
  available: boolean
  checkedAt: string
}

export type EventType =
  | 'price_up'
  | 'price_down'
  | 'out_of_stock'
  | 'back_in_stock'
  | 'tracking_started'
  | 'target_reached'
  | 'all_time_low'
  | 'coupon_added'
  | 'deal_started'

export interface TrackerEvent {
  id: number
  asin: string
  type: EventType
  oldPrice: number | null
  newPrice: number | null
  createdAt: string
}

export interface ExchangeRate {
  /** COP per 1 USD. */
  rate: number
  fetchedAt: string
  source: string
}

export interface Settings {
  emailTo: string
  emailFrom: string
  hasResendKey: boolean
  intervalMinutes: number
  threshold: Threshold
  desktopNotifications: boolean
  launchAtStartup: boolean
  /** Optional manual COP/USD rate that overrides the fetched one. */
  manualRate: number | null
  telegramEnabled: boolean
  telegramChatId: string | null
  hasTelegramToken: boolean
  /** Price alerts during these local hours wait until the window ends. */
  quietEnabled: boolean
  quietStart: number
  quietEnd: number
  /** Summary of all products by email/Telegram; weekly ones go out on Mondays. */
  digest: 'off' | 'daily' | 'weekly'
  digestHour: number
  /** UI and alert language. */
  language: 'en' | 'es'
  /** Alerts are held (like quiet hours) until this time; set by /pausar. */
  pausedUntil: string | null
  /** Also track the cart's "Saved for later" items. */
  trackSavedForLater: boolean
  /** Amazon wishlist links whose items are tracked. */
  wishlists: string[]
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error'
  version: string | null
  error: string | null
}

export type SessionState = 'unknown' | 'logged_in' | 'logged_out' | 'captcha'

export interface Status {
  session: SessionState
  running: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  lastError: string | null
  exchangeRate: ExchangeRate | null
  appVersion: string
  update: UpdateState
}
