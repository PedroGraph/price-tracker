import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'node:path'
import type { ProductSource, RunRecord, DashboardStats, EventType, PriceReading, Product, Threshold, TrackerEvent, AlertItem } from '@shared/types'

let db: DatabaseSync

function transaction(fn: () => void): void {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

const MIGRATIONS = [
  `CREATE TABLE products (
     asin TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     url TEXT NOT NULL,
     image TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     track_offers INTEGER NOT NULL DEFAULT 0,
     base_price REAL,
     last_price REAL,
     last_shipping REAL,
     last_seller TEXT,
     available INTEGER,
     threshold_unit TEXT,
     threshold_value REAL,
     added_at TEXT NOT NULL,
     last_checked_at TEXT
   );
   CREATE TABLE price_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     asin TEXT NOT NULL REFERENCES products(asin),
     price REAL,
     shipping REAL,
     seller TEXT,
     source TEXT NOT NULL,
     available INTEGER NOT NULL,
     checked_at TEXT NOT NULL
   );
   CREATE INDEX idx_history_asin ON price_history(asin, checked_at);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     asin TEXT NOT NULL REFERENCES products(asin),
     type TEXT NOT NULL,
     old_price REAL,
     new_price REAL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `ALTER TABLE price_history ADD COLUMN condition TEXT;`,
  `ALTER TABLE products ADD COLUMN target_price REAL;`,
  `ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT 'cart';`,
  `ALTER TABLE products ADD COLUMN coupon TEXT; ALTER TABLE products ADD COLUMN deal TEXT;`,
  `ALTER TABLE products ADD COLUMN last_import_fees REAL;`,
  `ALTER TABLE price_history ADD COLUMN seller_id TEXT; ALTER TABLE products ADD COLUMN last_seller_id TEXT;`,
  `CREATE TABLE runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     started_at TEXT NOT NULL,
     duration_ms INTEGER NOT NULL,
     outcome TEXT NOT NULL,
     message TEXT,
     checked INTEGER NOT NULL,
     unreadable INTEGER NOT NULL,
     alerts INTEGER NOT NULL
   );`,
  `ALTER TABLE products ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`
]

export function openDb(file = join(app.getPath('userData'), 'tracker.db')): void {
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(() => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

const now = (): string => new Date().toISOString()

type ProductRow = Record<string, unknown>

function parseTags(value: unknown): string[] {
  try {
    const tags = JSON.parse(typeof value === 'string' ? value : '[]')
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function toProduct(r: ProductRow): Product {
  return {
    asin: r.asin as string,
    title: r.title as string,
    url: r.url as string,
    image: (r.image as string) ?? null,
    active: r.active === 1,
    trackOffers: r.track_offers === 1,
    basePrice: (r.base_price as number) ?? null,
    lastPrice: (r.last_price as number) ?? null,
    lastShipping: (r.last_shipping as number) ?? null,
    lastSeller: (r.last_seller as string) ?? null,
    lastSellerId: (r.last_seller_id as string) ?? null,
    available: r.available === null ? null : r.available === 1,
    threshold: r.threshold_unit
      ? { unit: r.threshold_unit as Threshold['unit'], value: r.threshold_value as number }
      : null,
    addedAt: r.added_at as string,
    lastCheckedAt: (r.last_checked_at as string) ?? null,
    firstPrice: null,
    spark: [],
    sellerCount: 0,
    baseSince: null,
    backInStock: false,
    targetPrice: (r.target_price as number) ?? null,
    source: (r.source as Product['source']) ?? 'cart',
    lastImportFees: (r.last_import_fees as number) ?? null,
    coupon: (r.coupon as string) ?? null,
    deal: (r.deal as string) ?? null,
    lowestPrice: null,
    lowest30: null,
    tags: parseTags(r.tags),
    avg30: null,
    runs30: 0,
    spanDays30: 0
  }
}

const ALERT_TYPES =
  "('price_up','price_down','out_of_stock','back_in_stock','target_reached','all_time_low','coupon_added','deal_started')"
const RUN = 'substr(checked_at, 1, 16)'

/** Adds the derived fields the dashboard shows. */
function enrich(p: Product): Product {
  const first = db
    .prepare(`SELECT price FROM price_history WHERE asin = ? AND price IS NOT NULL AND source = 'buybox' ORDER BY id LIMIT 1`)
    .get(p.asin) as { price: number } | undefined
  // Tracked price per check: the cheapest reading of each run (buy box or offer).
  const spark = (
    db
      .prepare(
        `SELECT MIN(price) AS price FROM price_history WHERE asin = ? AND price IS NOT NULL
         GROUP BY ${RUN} ORDER BY ${RUN} DESC LIMIT 24`
      )
      .all(p.asin) as { price: number }[]
  )
    .map((r) => r.price)
    .reverse()
  const lastOfferRun = db
    .prepare(`SELECT MAX(${RUN}) AS run FROM price_history WHERE asin = ? AND source = 'offer'`)
    .get(p.asin) as { run: string | null }
  const sellers = lastOfferRun.run
    ? (
        db
          .prepare(`SELECT COUNT(DISTINCT seller) AS n FROM price_history WHERE asin = ? AND source = 'offer' AND ${RUN} = ?`)
          .get(p.asin, lastOfferRun.run) as { n: number }
      ).n
    : 0
  const baseEvent = db
    .prepare(
      `SELECT created_at FROM events WHERE asin = ? AND type IN ('price_up','price_down','tracking_started') ORDER BY id DESC LIMIT 1`
    )
    .get(p.asin) as { created_at: string } | undefined
  const back = db
    .prepare(`SELECT 1 FROM events WHERE asin = ? AND type = 'back_in_stock' AND created_at >= ? LIMIT 1`)
    .get(p.asin, new Date(Date.now() - 86_400_000).toISOString())
  const lows = db
    .prepare(
      `SELECT MIN(price) AS ever, MIN(CASE WHEN checked_at >= ? THEN price END) AS last30
       FROM price_history WHERE asin = ? AND price IS NOT NULL`
    )
    .get(new Date(Date.now() - 30 * 86_400_000).toISOString(), p.asin) as { ever: number | null; last30: number | null }
  // One tracked price per check (the cheapest reading of that check) over the last 30 days.
  const month = db
    .prepare(
      `SELECT AVG(price) AS avg, COUNT(*) AS runs, MIN(t) AS first, MAX(t) AS last FROM (
         SELECT MIN(price) AS price, MIN(checked_at) AS t FROM price_history
         WHERE asin = ? AND price IS NOT NULL AND checked_at >= ? GROUP BY ${RUN})`
    )
    .get(p.asin, new Date(Date.now() - 30 * 86_400_000).toISOString()) as {
    avg: number | null
    runs: number
    first: string | null
    last: string | null
  }
  return {
    ...p,
    avg30: month.avg === null ? null : Math.round(month.avg * 100) / 100,
    runs30: month.runs,
    spanDays30: month.first && month.last ? (Date.parse(month.last) - Date.parse(month.first)) / 86_400_000 : 0,
    lowestPrice: lows.ever,
    lowest30: lows.last30,
    firstPrice: first?.price ?? null,
    spark,
    sellerCount: p.trackOffers ? sellers : 0,
    baseSince: baseEvent?.created_at ?? null,
    backInStock: !!back && p.available === true
  }
}

export function getStats(): DashboardStats {
  const products = listProducts(true)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  let saved = 0
  for (const p of products) {
    if (p.lastPrice === null) continue
    const start = db
      .prepare(
        `SELECT price FROM price_history WHERE asin = ? AND price IS NOT NULL AND source = 'buybox' AND checked_at >= ? ORDER BY id LIMIT 1`
      )
      .get(p.asin, weekAgo) as { price: number } | undefined
    if (start && start.price > p.lastPrice) saved += start.price - p.lastPrice
  }
  const alerts = db
    .prepare(`SELECT COUNT(*) AS n FROM events WHERE type IN ${ALERT_TYPES} AND created_at >= ?`)
    .get(new Date(Date.now() - 30 * 86_400_000).toISOString()) as { n: number }
  return {
    tracked: products.length,
    droppedCount: products.filter((p) => p.firstPrice !== null && p.lastPrice !== null && p.lastPrice < p.firstPrice).length,
    savedThisWeek: Math.round(saved * 100) / 100,
    alertsLast30Days: alerts.n
  }
}

export function listProducts(activeOnly = false): Product[] {
  const sql = `SELECT * FROM products ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, title`
  return (db.prepare(sql).all() as ProductRow[]).map(toProduct).map(enrich)
}

export function getProduct(asin: string): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE asin = ?').get(asin) as ProductRow | undefined
  return row ? enrich(toProduct(row)) : null
}

/** Makes the product list match the cart: new items are added, missing ones stop being tracked. */
const SOURCE_RANK: Record<ProductSource, number> = { cart: 0, saved: 1, wishlist: 2, manual: 3 }

/**
 * Makes tracked products match what's on Amazon: items found in the cart, "Saved for later"
 * and wishlists are added (an item in several places takes the first of cart > saved >
 * wishlist), and products that were only there stop being tracked. Sources in `keep` weren't
 * read this time (off, or couldn't be loaded), so their products are left as they are.
 * Products added by link ('manual') are never touched.
 */
export function syncSources(
  items: { asin: string; title: string; url: string; image: string | null; source: Exclude<ProductSource, 'manual'> }[],
  keep: Exclude<ProductSource, 'manual'>[] = []
): void {
  const best = new Map<string, (typeof items)[number]>()
  for (const i of items) {
    const prev = best.get(i.asin)
    if (!prev || SOURCE_RANK[i.source] < SOURCE_RANK[prev.source]) best.set(i.asin, i)
  }
  transaction(() => {
    const upsert = db.prepare(
      `INSERT INTO products (asin, title, url, image, active, source, added_at) VALUES (@asin, @title, @url, @image, 1, @source, @now)
       ON CONFLICT(asin) DO UPDATE SET title = CASE WHEN @title = @asin THEN title ELSE @title END, url = @url,
         image = CASE WHEN @image IS NULL THEN image ELSE @image END, active = 1,
         source = CASE WHEN source = 'manual' AND active = 1 THEN 'manual' ELSE @source END`
    )
    for (const { asin, title, url, image, source } of best.values()) upsert.run({ asin, title, url, image, source, now: now() })
    const asins = [...best.keys()]
    const managed = (['cart', 'saved', 'wishlist'] as const).filter((s) => !keep.includes(s))
    if (managed.length === 0) return
    db.prepare(
      `UPDATE products SET active = 0 WHERE source IN (${managed.map(() => '?').join(',')})
       AND asin NOT IN (${asins.map(() => '?').join(',') || "''"})`
    ).run(...managed, ...asins)
  })
}

export function updateProductState(
  asin: string,
  s: {
    basePrice: number | null
    lastPrice: number | null
    lastShipping: number | null
    lastSeller: string | null
    lastSellerId: string | null
    available: boolean
  }
): void {
  db.prepare(
    `UPDATE products SET base_price = ?, last_price = ?, last_shipping = ?, last_seller = ?, last_seller_id = ?, available = ?,
     last_checked_at = ? WHERE asin = ?`
  ).run(s.basePrice, s.lastPrice, s.lastShipping, s.lastSeller, s.lastSellerId, s.available ? 1 : 0, now(), asin)
}

/** Adds (or re-activates) a product tracked by URL. The title is filled in on the first check. */
export function addManualProduct(asin: string): void {
  db.prepare(
    `INSERT INTO products (asin, title, url, active, source, added_at) VALUES (?, ?, ?, 1, 'manual', ?)
     ON CONFLICT(asin) DO UPDATE SET active = 1, source = CASE WHEN active = 1 THEN source ELSE 'manual' END`
  ).run(asin, asin, `https://www.amazon.com/dp/${asin}`, now())
}

/** Sets every base price to the current price, or to the delivered total when `total` is on. */
export function rebaseAll(total: boolean): void {
  db.prepare(
    total
      ? `UPDATE products SET base_price = CASE WHEN last_price IS NULL THEN base_price
           ELSE ROUND(last_price + COALESCE(last_shipping, 0) + COALESCE(last_import_fees, 0), 2) END`
      : `UPDATE products SET base_price = COALESCE(last_price, base_price)`
  ).run()
}

/** Stops tracking a product; its history is kept. */
export function deactivateProduct(asin: string): void {
  db.prepare('UPDATE products SET active = 0 WHERE asin = ?').run(asin)
}

/** First tracked price (cheapest reading of a check) at or after `since`. */
export function firstPriceSince(asin: string, since: string): number | null {
  const r = db
    .prepare(
      `SELECT MIN(price) AS price FROM price_history WHERE asin = ? AND price IS NOT NULL AND checked_at >= ?
       GROUP BY ${RUN} ORDER BY ${RUN} LIMIT 1`
    )
    .get(asin, since) as { price: number } | undefined
  return r?.price ?? null
}

/** Every reading joined with its product, oldest first; optionally for one product. */
export function exportRows(asin?: string): Record<string, string | number | null>[] {
  return db
    .prepare(
      `SELECT h.asin, p.title, h.checked_at, h.source, h.seller, h.seller_id, h.condition, h.price AS price_usd,
              h.shipping AS shipping_usd, h.available
       FROM price_history h JOIN products p ON p.asin = h.asin
       ${asin ? 'WHERE h.asin = ?' : ''} ORDER BY h.id`
    )
    .all(...(asin ? [asin] : [])) as Record<string, string | number | null>[]
}

export function countAlertsSince(since: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type IN ${ALERT_TYPES} AND created_at >= ?`).get(since) as { n: number }).n
}

export function setPromotions(asin: string, coupon: string | null, deal: string | null, importFees: number | null): void {
  db.prepare('UPDATE products SET coupon = ?, deal = ?, last_import_fees = ? WHERE asin = ?').run(coupon, deal, importFees, asin)
}

export function setProductTitle(asin: string, title: string): void {
  db.prepare('UPDATE products SET title = ? WHERE asin = ?').run(title, asin)
}

export function setProductImage(asin: string, image: string): void {
  db.prepare('UPDATE products SET image = ? WHERE asin = ?').run(image, asin)
}

/** Lowest tracked price and number of checks before the current run. */
export function priceStats(asin: string): { lowest: number | null; readings: number } {
  const r = db
    .prepare(`SELECT MIN(price) AS lowest, COUNT(DISTINCT ${RUN}) AS readings FROM price_history WHERE asin = ? AND price IS NOT NULL`)
    .get(asin) as { lowest: number | null; readings: number }
  return r
}

export function setProductOptions(
  asin: string,
  opts: { trackOffers?: boolean; threshold?: Threshold | null; targetPrice?: number | null; tags?: string[] }
): void {
  if (opts.tags !== undefined) {
    db.prepare('UPDATE products SET tags = ? WHERE asin = ?').run(JSON.stringify(cleanTags(opts.tags)), asin)
  }
  if (opts.targetPrice !== undefined) {
    db.prepare('UPDATE products SET target_price = ? WHERE asin = ?').run(opts.targetPrice, asin)
  }
  if (opts.trackOffers !== undefined) {
    db.prepare('UPDATE products SET track_offers = ? WHERE asin = ?').run(opts.trackOffers ? 1 : 0, asin)
  }
  if (opts.threshold !== undefined) {
    db.prepare('UPDATE products SET threshold_unit = ?, threshold_value = ? WHERE asin = ?').run(
      opts.threshold?.unit ?? null,
      opts.threshold?.value ?? null,
      asin
    )
  }
}

export function addReading(r: Omit<PriceReading, 'id' | 'checkedAt'>): void {
  db.prepare(
    `INSERT INTO price_history (asin, price, shipping, seller, seller_id, condition, source, available, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(r.asin, r.price, r.shipping, r.seller, r.sellerId, r.condition, r.source, r.available ? 1 : 0, now())
}

export function getHistory(asin: string): PriceReading[] {
  return (db.prepare('SELECT * FROM price_history WHERE asin = ? ORDER BY checked_at').all(asin) as ProductRow[]).map(
    (r) => ({
      id: r.id as number,
      asin: r.asin as string,
      price: (r.price as number) ?? null,
      shipping: (r.shipping as number) ?? null,
      seller: (r.seller as string) ?? null,
      sellerId: (r.seller_id as string) ?? null,
      condition: (r.condition as string) ?? null,
      source: r.source as PriceReading['source'],
      available: r.available === 1,
      checkedAt: r.checked_at as string
    })
  )
}

export function addEvent(asin: string, type: EventType, oldPrice: number | null, newPrice: number | null): void {
  db.prepare('INSERT INTO events (asin, type, old_price, new_price, created_at) VALUES (?, ?, ?, ?, ?)').run(
    asin,
    type,
    oldPrice,
    newPrice,
    now()
  )
}

export function getEvents(asin: string): TrackerEvent[] {
  return (db.prepare('SELECT * FROM events WHERE asin = ? ORDER BY created_at DESC').all(asin) as ProductRow[]).map(
    (r) => ({
      id: r.id as number,
      asin: r.asin as string,
      type: r.type as EventType,
      oldPrice: (r.old_price as number) ?? null,
      newPrice: (r.new_price as number) ?? null,
      createdAt: r.created_at as string
    })
  )
}

/** How many price drops each product had since a date. */
export function dropCountsSince(since: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT asin, COUNT(*) AS n FROM events WHERE type = 'price_down' AND created_at >= ? GROUP BY asin`)
    .all(since) as { asin: string; n: number }[]
  return new Map(rows.map((r) => [r.asin, r.n]))
}

/** Alerts of the last 30 days, newest first, for the bell. */
export function listRecentAlerts(limit = 60): AlertItem[] {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  return (
    db
      .prepare(
        `SELECT e.*, p.title, p.image FROM events e JOIN products p ON p.asin = e.asin
         WHERE e.type IN ${ALERT_TYPES} AND e.created_at >= ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?`
      )
      .all(since, limit) as ProductRow[]
  ).map((r) => ({
    id: r.id as number,
    asin: r.asin as string,
    type: r.type as EventType,
    oldPrice: (r.old_price as number) ?? null,
    newPrice: (r.new_price as number) ?? null,
    createdAt: r.created_at as string,
    title: r.title as string,
    image: (r.image as string) ?? null
  }))
}

// ---- backups

/** Tables in a backup, in insert order (products first: the others point to it). */
const BACKUP_TABLES = ['products', 'price_history', 'events', 'settings'] as const
/** Settings that are secrets, or only make sense on this machine. */
const LOCAL_SETTINGS = ['resendKey', 'telegramToken', 'cookiesReencrypted', 'health', 'queuedAlerts']

export function schemaVersion(): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

export function dumpForBackup(): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {}
  for (const table of BACKUP_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
    out[table] = table === 'settings' ? rows.filter((r) => !LOCAL_SETTINGS.includes(r.key as string)) : rows.map((r) => ({ ...r }))
  }
  return out
}

/**
 * Replaces the data with a backup's, in one transaction. Only columns that exist here are
 * copied, so backups from older versions still load. Local-only settings are kept.
 */
export function restoreFromBackup(data: Record<string, Record<string, unknown>[]>): void {
  transaction(() => {
    for (const table of [...BACKUP_TABLES].reverse()) {
      if (table === 'settings') {
        db.prepare(`DELETE FROM settings WHERE key NOT IN (${LOCAL_SETTINGS.map(() => '?').join(',')})`).run(...LOCAL_SETTINGS)
      } else db.exec(`DELETE FROM ${table}`)
    }
    for (const table of BACKUP_TABLES) {
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name))
      for (const row of data[table] ?? []) {
        if (table === 'settings' && LOCAL_SETTINGS.includes(row.key as string)) continue
        const keys = Object.keys(row).filter((k) => columns.has(k))
        if (keys.length === 0) continue
        db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
          ...keys.map((k) => row[k] as string | number | null)
        )
      }
    }
  })
}

/** Keeps the last 200 runs. */
export function addRun(r: Omit<RunRecord, 'id'>): void {
  db.prepare(
    'INSERT INTO runs (started_at, duration_ms, outcome, message, checked, unreadable, alerts) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(r.startedAt, r.durationMs, r.outcome, r.message, r.checked, r.unreadable, r.alerts)
  db.prepare('DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY id DESC LIMIT 200)').run()
}

export function listRuns(limit = 30): RunRecord[] {
  return (db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    startedAt: r.started_at as string,
    durationMs: r.duration_ms as number,
    outcome: r.outcome as RunRecord['outcome'],
    message: (r.message as string) ?? null,
    checked: r.checked as number,
    unreadable: r.unreadable as number,
    alerts: r.alerts as number
  }))
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}

export function setSetting(key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  )
}

/** Trimmed, de-duplicated (ignoring case), at most 10 tags of 30 characters. */
export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const tag = t.trim().replace(/\s+/g, ' ').slice(0, 30)
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag)
  }
  return out.slice(0, 10)
}
