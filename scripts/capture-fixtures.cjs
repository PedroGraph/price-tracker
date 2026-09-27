/**
 * Captures trimmed, anonymized copies of real Amazon pages into tests/fixtures,
 * using the app's saved session. Only the elements the extractors read are kept;
 * the account name, address and everything else are dropped.
 *
 *   npx electron scripts/capture-fixtures.cjs <ASIN> [OFFERS_ASIN]
 *
 * Close the app first (it shares the session). Files go to tests/fixtures/signed-in
 * or tests/fixtures/signed-out depending on the session. Review them before committing.
 */
const { app, BrowserWindow, session } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

app.setPath('userData', join(app.getPath('appData'), 'amazon-price-tracker'))
const OUT = join(__dirname, '..', 'tests', 'fixtures')
const [asin, offersAsin = asin] = process.argv.slice(2).filter((a) => /^[A-Z0-9]{10}$/.test(a))

// Runs in the page: keeps only the listed selectors, strips scripts/styles/attributes we don't need.
const TRIM = `(selectors) => {
  const keep = new Set(['id', 'class', 'data-asin', 'data-itemtype', 'data-price', 'data-csa-c-delivery-price', 'src', 'data-old-hires', 'data-a-hires', 'href'])
  const clean = (el) => {
    el.querySelectorAll('script, style, noscript, iframe, svg, form input[type=hidden]').forEach((n) => n.remove())
    for (const n of [el, ...el.querySelectorAll('*')]) {
      for (const a of [...n.attributes]) if (!keep.has(a.name)) n.removeAttribute(a.name)
      if (n.hasAttribute('href')) n.setAttribute('href', n.getAttribute('href').split('?')[0].replace(/\\/ref=.*/, ''))
    }
    return el.outerHTML
  }
  const parts = []
  for (const s of selectors) document.querySelectorAll(s).forEach((el) => parts.push(clean(el.cloneNode(true))))
  return parts.join('\\n')
}`

const ACCOUNT = `<a id="nav-link-accountList" href="https://www.amazon.com/gp/css/homepage.html"><span id="nav-link-accountList-nav-line-1">Hello, Test</span></a>`

let folder = 'signed-out'

async function capture(win, url, selectors, file, withAccount = true) {
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 3000))
  if (file === 'cart.html') {
    const signedIn = await win.webContents.executeJavaScript(
      `!!document.querySelector('#nav-link-accountList') && !document.querySelector('#nav-link-accountList').href.includes('/ap/signin')`
    )
    folder = signedIn ? 'signed-in' : 'signed-out'
    mkdirSync(join(OUT, folder), { recursive: true })
  }
  const body = await win.webContents.executeJavaScript(`(${TRIM})(${JSON.stringify(selectors)})`)
  const html = `<!doctype html><html><body>\n${withAccount ? ACCOUNT + '\n' : ''}${body}\n</body></html>\n`
  writeFileSync(join(OUT, folder, file), html)
  console.log(`${folder}/${file}: ${html.length} bytes`)
}

app.whenReady().then(async () => {
  if (!asin) {
    console.error('Usage: npx electron scripts/capture-fixtures.cjs <ASIN> [OFFERS_ASIN]')
    return app.exit(1)
  }
  mkdirSync(OUT, { recursive: true })
  const ses = session.fromPartition('persist:amazon')
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|amazon-price-tracker)\/\S+/g, ''))
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } })
  try {
    await capture(win, 'https://www.amazon.com/gp/cart/view.html', ['#sc-active-cart'], 'cart.html')
    await capture(
      win,
      `https://www.amazon.com/dp/${asin}?th=1&psc=1`,
      [
        '#landingImage',
        '#corePrice_feature_div',
        '#corePriceDisplay_desktop_feature_div',
        '#availability',
        '#mir-layout-DELIVERY_BLOCK',
        '#merchantInfoFeature_feature_div'
      ],
      'product.html'
    )
    await capture(
      win,
      `https://www.amazon.com/gp/product/ajax/aodAjaxMain/?asin=${offersAsin}&pc=dp`,
      ['#aod-pinned-offer', '#aod-offer'],
      'offers.html',
      false
    )
  } finally {
    app.quit()
  }
})
