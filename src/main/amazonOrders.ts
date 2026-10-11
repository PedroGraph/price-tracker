import { amazonPackages } from '@shared/shipping'
import type { StoreReader } from './accounts'
import { openAmazonWindow, Scraper, SessionError } from './scraper/amazon'
import { status } from './tracker'

/**
 * Your Amazon orders, read with the Amazon session the app already has: connecting it
 * needs no new sign-in, and disconnecting only stops the reading (the session stays, the
 * price checks need it).
 */
export const amazonOrders: StoreReader = {
  id: 'amazon',
  name: 'Amazon',
  key: 'amazonOrders',
  every: 2 * 60 * 60_000,
  // Only when the last read or the last price check found the session closed. The window opens
  // on the orders themselves: Amazon asks for the password again there, which signing in to the
  // cart doesn't cover.
  connect: async (parent, state) => {
    if (state === 'login' || state === 'check' || status.session === 'logged_out' || status.session === 'captcha') await openAmazonWindow(parent, undefined, true)
  },
  disconnect: async () => undefined,
  read: async () => {
    const scraper = new Scraper()
    try {
      return { kind: 'ok', packages: amazonPackages(await scraper.orders()) }
    } catch (err) {
      if (err instanceof SessionError) return { kind: err.state === 'captcha' ? 'check' : 'login' }
      return { kind: 'error' }
    } finally {
      scraper.close()
    }
  }
}
