import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { evaluateReading, extraEvents, promoEvents } from '@shared/pricing'
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
  const outcome = await track()

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
  let checked = 0

  try {
    const cart = await scraper.cart(rate)
    status.session = 'logged_in'
    db.syncCart(cart)
    emit()

    for (const product of db.listProducts(true)) {
      checked++
      await scraper.pause()
      const { image, title, coupon, deal, importFees, readable, ...page } = await scraper.product(product.asin, rate)
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
      db.setPromotions(product.asin, coupon, deal, importFees)
      db.addReading({ asin: product.asin, ...page, condition: null, source: 'buybox' })

      // With "other sellers" on, the tracked price is the cheapest offer (shipping excluded).
      let best = { price: page.price, shipping: page.shipping, seller: page.seller }
      if (product.trackOffers) {
        await scraper.pause()
        for (const offer of await scraper.offers(product.asin, rate)) {
          db.addReading({ asin: product.asin, ...offer, source: 'offer', available: true })
          if (best.price === null || offer.price < best.price) {
            best = { price: offer.price, shipping: offer.shipping, seller: offer.seller }
          }
        }
      }
      const available = page.available || (product.trackOffers && best.price !== null)

      const result = evaluateReading({
        basePrice: product.basePrice,
        wasAvailable: product.available,
        price: available ? best.price : null,
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
      for (const type of [...result.events, ...extra, ...promos]) {
        db.addEvent(product.asin, type, product.basePrice, best.price)
        if (type !== 'tracking_started') {
          alerts.push({ product: { ...product, coupon, deal }, type, oldPrice: product.basePrice, newPrice: best.price, ...best })
        }
      }
      db.updateProductState(product.asin, {
        basePrice: result.newBase,
        lastPrice: best.price,
        lastShipping: best.shipping,
        lastSeller: best.seller,
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

  if (checked > 0 && unreadable.length === checked) {
    return { kind: 'broken', reason: `Product pages: no price or availability found (${unreadable.join(', ')})` }
  }
  return { kind: 'ok' }
}
