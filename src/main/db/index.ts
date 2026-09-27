import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'node:path'
import type { DashboardStats, EventType, PriceReading, Product, Threshold, TrackerEvent } from '@shared/types'

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
  `ALTER TABLE products ADD COLUMN coupon TEXT; ALTER TABLE products ADD COLUMN deal TEXT;`
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
    coupon: (r.coupon as string) ?? null,
    deal: (r.deal as string) ?? null,
    lowestPrice: null,
    lowest30: null
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
  return {
    ...p,
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
export function syncCart(items: { asin: string; title: string; url: string; image: string | null }[]): void {
  transaction(() => {
    const upsert = db.prepare(
      `INSERT INTO products (asin, title, url, image, active, added_at) VALUES (@asin, @title, @url, @image, 1, @now)
       ON CONFLICT(asin) DO UPDATE SET title = @title, url = @url, image = CASE WHEN @image IS NULL THEN image ELSE @image END, active = 1`
    )
    for (const { asin, title, url, image } of items) upsert.run({ asin, title, url, image, now: now() })
    // Only cart products leave with the cart; products added by URL stay until removed.
    const asins = items.map((i) => i.asin)
    db.prepare(
      `UPDATE products SET active = 0 WHERE source = 'cart' AND asin NOT IN (${asins.map(() => '?').join(',') || "''"})`
    ).run(...asins)
  })
}

export function updateProductState(
  asin: string,
  s: { basePrice: number | null; lastPrice: number | null; lastShipping: number | null; lastSeller: string | null; available: boolean }
): void {
  db.prepare(
    `UPDATE products SET base_price = ?, last_price = ?, last_shipping = ?, last_seller = ?, available = ?, last_checked_at = ?
     WHERE asin = ?`
  ).run(s.basePrice, s.lastPrice, s.lastShipping, s.lastSeller, s.available ? 1 : 0, now(), asin)
}

/** Adds (or re-activates) a product tracked by URL. The title is filled in on the first check. */
export function addManualProduct(asin: string): void {
  db.prepare(
    `INSERT INTO products (asin, title, url, active, source, added_at) VALUES (?, ?, ?, 1, 'manual', ?)
     ON CONFLICT(asin) DO UPDATE SET active = 1, source = CASE WHEN active = 1 THEN source ELSE 'manual' END`
  ).run(asin, asin, `https://www.amazon.com/dp/${asin}`, now())
}

/** Stops tracking a product; its history is kept. */
export function deactivateProduct(asin: string): void {
  db.prepare('UPDATE products SET active = 0 WHERE asin = ?').run(asin)
}

export function setPromotions(asin: string, coupon: string | null, deal: string | null): void {
  db.prepare('UPDATE products SET coupon = ?, deal = ? WHERE asin = ?').run(coupon, deal, asin)
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
  opts: { trackOffers?: boolean; threshold?: Threshold | null; targetPrice?: number | null }
): void {
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
    `INSERT INTO price_history (asin, price, shipping, seller, condition, source, available, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(r.asin, r.price, r.shipping, r.seller, r.condition, r.source, r.available ? 1 : 0, now())
}

export function getHistory(asin: string): PriceReading[] {
  return (db.prepare('SELECT * FROM price_history WHERE asin = ? ORDER BY checked_at').all(asin) as ProductRow[]).map(
    (r) => ({
      id: r.id as number,
      asin: r.asin as string,
      price: (r.price as number) ?? null,
      shipping: (r.shipping as number) ?? null,
      seller: (r.seller as string) ?? null,
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
