import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { cleanDeal, evaluateReading, extraEvents, landedTotal, promoEvents } from '@shared/pricing'
import type { Status } from '@shared/types'
import * as db from './db'
import { cachedRate, currentRate, refreshRate } from './exchange'
import { recordOutcome, RETRY_DELAYS_MIN, type RunOutcome } from './health'
import { deliverAlerts, flushQueuedAlerts, type Alert } from './notify'
import { PageChangedError, Scraper, SessionError } from './scraper/amazon'
import { getSettings } from './settings'

export const status: Status = {
  session: 'unknown',
  running: false,
  lastRunAt: null,
  nextRunAt: null,
  lastError: null,
  exchangeRate: null,
  appVersion: app.getVersion(),
  update: { status: 'idle', version: null, error: null }
}

/** Emits 'status' whenever `status` or the product data changes. */
export const events = new EventEmitter()
const emit = (): void => void events.emit('status', { ...status })

let timer: NodeJS.Timeout | null = null
/** Failed runs in a row; drives the retry backoff. */
let failedRuns = 0

export function schedule(): void {
  if (timer) clearTimeout(timer)
  const interval = getSettings().intervalMinutes
  const minutes = failedRuns > 0 ? Math.min(RETRY_DELAYS_MIN[failedRuns - 1] ?? interval, interval) : interval
  status.nextRunAt = new Date(Date.now() + minutes * 60_000).toISOString()
  timer = setTimeout(() => void runCheck().finally(schedule), minutes * 60_000)
  emit()
}

/** Numbers for the diagnostics log, filled in by track(). */
let counts = { checked: 0, unreadable: 0, alerts: 0 }

/** A check asked for while one is running (e.g. a product was just added) runs right after it. */
let rerunRequested = false

export async function runCheck(): Promise<void> {
  if (status.running) {
    rerunRequested = true
    return
  }
  status.running = true
  status.lastError = null
  emit()

  status.exchangeRate = (await refreshRate()) ?? cachedRate()
  const startedAt = new Date()
  counts = { checked: 0, unreadable: 0, alerts: 0 }
  const outcome = await track()
  db.addRun({
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    outcome: outcome.kind,
    message: outcome.kind === 'ok' ? null : outcome.kind === 'broken' ? outcome.reason : outcome.message,
    ...counts
  })

  if (outcome.kind === 'ok') {
    failedRuns = 0
  } else {
    failedRuns++
    status.lastError = outcome.kind === 'broken' ? `Couldn't read Amazon: ${outcome.reason}` : outcome.message
  }
  await recordOutcome(outcome)

  status.running = false
  status.lastRunAt = new Date().toISOString()
  emit()

  if (rerunRequested) {
    rerunRequested = false
    await runCheck()
  }
}

async function track(): Promise<RunOutcome> {
  const rate = currentRate()
  const settings = getSettings()
  const scraper = new Scraper()
  const alerts: Alert[] = []
  const unreadable: string[] = []
  const wishlistErrors: string[] = []
  let checked = 0

  try {
    const cart = await scraper.cart(rate)
    status.session = 'logged_in'
    type Item = Parameters<typeof db.syncSources>[0][number]
    const found: Item[] = cart
      .filter((i) => i.section === 'cart' || settings.trackSavedForLater)
      .map((i) => ({ ...i, source: i.section }))
    const keep: Parameters<typeof db.syncSources>[1] = settings.trackSavedForLater ? [] : ['saved']
    let wishlistsOk = true
    for (const url of settings.wishlists) {
      try {
        await scraper.pause()
        for (const i of await scraper.wishlist(url)) found.push({ ...i, source: 'wishlist' })
      } catch (e) {
        if (e instanceof SessionError) throw e
        // A list we can't read this time: leave its products alone rather than dropping them.
        wishlistsOk = false
        wishlistErrors.push(e instanceof Error ? e.message : String(e))
      }
    }
    if (!wishlistsOk) keep.push('wishlist')
    db.syncSources(found, keep)
    emit()

    for (const product of db.listProducts(true)) {
      checked++
      await scraper.pause()
      const { image, title, coupon, deal, importFees, readable, extras, ...page } = await scraper.product(product.asin, rate)
      if (title && product.title === product.asin) db.setProductTitle(product.asin, title)
      if (image && (!product.image || /loadIndicators/.test(product.image))) db.setProductImage(product.asin, image)

      // No price and no "unavailable" text: the page didn't match our selectors.
      // Skip it rather than report a false "out of stock".
      if (!readable) {
        unreadable.push(product.asin)
        continue
      }
      const before = db.priceStats(product.asin)
      // On the first check there's nothing to compare with, so no "coupon appeared" alert.
      const promos = product.lastCheckedAt ? promoEvents(product, { coupon, deal }) : []
      db.setPromotions(product.asin, coupon, cleanDeal(deal), importFees)
      db.addReading({ asin: product.asin, ...page, sellerId: null, condition: null, source: 'buybox' })

      // With "other sellers" on, the tracked price is the cheapest offer (shipping excluded).
      let best: { price: number | null; shipping: number | null; seller: string | null; sellerId: string | null } = {
        price: page.price,
        shipping: page.shipping,
        seller: page.seller,
        sellerId: null
      }
      // Cheapest "Amazon Resale" (Warehouse) offer: returns Amazon inspected, sold for less.
      let resale: number | null = null
      if (product.trackOffers) {
        await scraper.pause()
        for (const offer of await scraper.offers(product.asin, rate)) {
          if (/amazon resale|warehouse/i.test(offer.seller) && (resale === null || offer.price < resale)) resale = offer.price
          db.addReading({ asin: product.asin, ...offer, source: 'offer', available: true })
          if (best.price === null || offer.price < best.price) {
            best = { price: offer.price, shipping: offer.shipping, seller: offer.seller, sellerId: offer.sellerId }
          }
        }
      }
      const available = page.available || (product.trackOffers && best.price !== null)
      if (extras) db.setProductExtras(product.asin, { ...extras, resalePrice: product.trackOffers ? resale : undefined })
      // Up/down alerts compare the price, or the delivered total when that's chosen in Settings.
      const compared = settings.alertOnTotal ? landedTotal(best.price, best.shipping, importFees) : best.price

      const result = evaluateReading({
        basePrice: product.basePrice,
        wasAvailable: product.available,
        price: available ? compared : null,
        available,
        threshold: product.threshold ?? settings.threshold,
        copPerUsd: rate
      })
      const extra = extraEvents({
        price: available ? best.price : null,
        previousPrice: product.lastPrice,
        targetPrice: product.targetPrice,
        lowestBefore: before.lowest,
        readingsBefore: before.readings,
        baseEvents: result.events
      })
      // Running out: "only N left" shows up (or drops to 5 or fewer) while it's in stock.
      const stockLeft = extras?.stockLeft ?? null
      const lowStock =
        available && stockLeft !== null && stockLeft <= 5 && (product.stockLeft === null || product.stockLeft > 5) ? (['low_stock'] as const) : []
      // Bought and still returnable: it got cheaper than what was paid (once per new low).
      const refund: 'refund_chance'[] = []
      if (product.purchase && available && best.price !== null && new Date().toISOString().slice(0, 10) <= product.purchase.returnUntil) {
        const paid = product.purchase.price
        const alerted = db.getRefundAlertedPrice(product.asin)
        if (best.price <= paid - Math.max(1, paid * 0.01) && (alerted === null || best.price < alerted)) {
          refund.push('refund_chance')
          db.setRefundAlertedPrice(product.asin, best.price)
        }
      }
      for (const type of [...result.events, ...extra, ...promos, ...lowStock, ...refund]) {
        const moved = type === 'price_up' || type === 'price_down' || type === 'tracking_started'
        const newPrice = moved ? compared : best.price
        db.addEvent(product.asin, type, product.basePrice, newPrice)
        if (type !== 'tracking_started') {
          alerts.push({ product: { ...product, coupon, deal, stockLeft }, type, oldPrice: product.basePrice, ...best, newPrice })
        }
      }
      db.updateProductState(product.asin, {
        basePrice: result.newBase,
        lastPrice: best.price,
        lastShipping: best.shipping,
        lastSeller: best.seller,
        lastSellerId: best.sellerId,
        available
      })
      emit()
    }
  } catch (err) {
    if (err instanceof SessionError) {
      status.session = err.state
      return { kind: 'session', message: err.message }
    }
    if (err instanceof PageChangedError) return { kind: 'broken', reason: err.message }
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  } finally {
    scraper.close()
  }

  try {
    await flushQueuedAlerts(rate)
    await deliverAlerts(alerts, rate)
  } catch (err) {
    return { kind: 'error', message: `Sending alerts failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  counts = { checked, unreadable: unreadable.length, alerts: alerts.length }
  if (checked > 0 && unreadable.length === checked) {
    return { kind: 'broken', reason: `Product pages: no price or availability found (${unreadable.join(', ')})` }
  }
  if (wishlistErrors.length) return { kind: 'error', message: wishlistErrors.join(' · ') }
  return { kind: 'ok' }
}
