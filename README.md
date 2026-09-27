# Amazon Price Tracker

A Windows desktop app (Electron + React + TypeScript) that watches the prices of everything in your **Amazon.com cart** and emails you when a price goes up or down, or when a product goes out of stock or comes back.

- Reads your cart from your own signed-in Amazon session. The session is kept between restarts.
- Checks every hour by default and keeps running in the system tray when you close the window.
- Saves **every** price reading, even tiny changes, so you get a full history chart per product.
- Alerts by email via [Resend](https://resend.com), on **Telegram**, and optionally with Windows notifications.
- Thresholds can be in **%**, **USD** or **COP**, set globally or per product. Prices can be shown in USD or COP.
- Optional per product: track **other sellers** of the same item on Amazon and follow the cheapest offer.
- Shipping is shown separately (“+ $X shipping”) and never counts toward the tracked price.
- **Target price** per product: one alert when the price reaches your number.
- **All-time low** alerts, plus the lowest price ever and in the last 30 days on each product.
- **Import fees**: when Amazon shows an import fees deposit (shipping abroad, e.g. to Colombia) it's shown next to shipping, with the delivered total.
- **Coupons and deals**: alerts when a coupon or a limited-time deal shows up, with the price after the coupon.
- **English or Spanish** interface and alerts (follows the Windows language until you pick one).
- **Export** any product's price history, or all of it, to CSV.
- **Track products outside your cart** by pasting a product link (including `amzn.to` links) or an ASIN.

## How alerts work

Each product has a **base price**, which starts as the first price seen.

1. Every check stores the price in the history.
2. If the current price is at least the threshold away from the base, an email is sent and **that price becomes the new base**.
3. Smaller moves don't touch the base, so several small drops in a row still add up and trigger an alert once they reach the threshold.

Availability changes (out of stock / back in stock) always trigger an alert.
Products you remove from your Amazon cart stop being tracked, and their history is kept.

## Requirements

- Windows 10/11
- [Node.js](https://nodejs.org) 22 or newer
- A free [Resend](https://resend.com) account for email alerts

The database uses SQLite built into Electron (`node:sqlite`), so there's nothing native to compile.

## Getting started

```bash
git clone <this repo>
cd amazon_price_tracker
npm install
npm run dev
```

To build a Windows installer into `release/`:

```bash
npm run dist
```

### 1. Sign in to Amazon

Click **Open Amazon** and sign in on the real amazon.com page, then close that window. The app never sees or stores your password. It only keeps the session cookies, like a browser does. If Amazon signs you out or asks for a CAPTCHA, the app tells you and you just open Amazon again from the app.

### 2. Set up Resend (email alerts)

Everyone who uses the app uses **their own** Resend API key.

1. Create an account at [resend.com](https://resend.com).
2. Go to **API Keys** → **Create API Key**. *Sending access* is enough.
3. In the app, open **Settings** and paste the key. Then fill in **Send alerts to** and click **Send test email**.

**About the sender address:** without a verified domain, Resend only lets you send from `onboarding@resend.dev` **to the email address you signed up with**. For a personal tracker that's all you need, so keep the default *From* value. To send to any address, [verify a domain](https://resend.com/domains) in Resend and change *From* to something like `Tracker <alerts@yourdomain.com>`.

### 3. Telegram alerts (optional)

1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps. Copy the token it gives you.
2. In the app's **Settings → Telegram alerts**, paste the token and click **Save**. The token is checked with Telegram and stored encrypted, like the Resend key.
3. Open your new bot in Telegram and send `/start`. Back in the app, click **Detect chat**, then **Send test message**.

Price alerts and the app's own warnings (signed out of Amazon, pages can't be read) go to every channel you set up.

### 4. Tune it

In **Settings**: a daily or weekly summary, quiet hours (price alerts wait until they end), the check interval (15 minutes minimum), the global threshold, Windows notifications, and starting with Windows (minimized to the tray).
On a product's page: the per-product threshold and **Track other sellers**.

## Exchange rate (USD ⇄ COP)

The COP/USD rate comes from [open.er-api.com](https://open.er-api.com) (free, no key needed) and is refreshed every 6 hours. Amazon doesn't publish the rate it uses for its own currency converter, so COP amounts are a close estimate. You can set a **manual rate** in Settings to override it.
Prices are stored in USD. If your Amazon account shows prices in COP, they're converted to USD when read. For the most accurate data, set Amazon's display currency to USD.

## Security and privacy

- **Resend API key:** encrypted with your Windows user account using Electron `safeStorage` (DPAPI). It's never written in plain text and never sent to the UI.
- **Amazon password:** never handled by the app. You type it straight into Amazon's page.
- **Amazon session:** stored in an isolated Electron partition (`persist:amazon`) inside your user profile.
- **The UI:** runs with `contextIsolation`, `sandbox` and no Node access, behind a strict Content Security Policy. It can only call the functions listed in `src/preload/index.ts`.
- **What's on disk:** all data (`tracker.db`) stays in `%APPDATA%\amazon-price-tracker`. Nothing is sent anywhere except to Amazon, Resend and the exchange-rate API.
- `.gitignore` excludes databases and `.env` files. **Never commit your API key.**

## Disclaimer

Amazon has no public API for carts. This app reads the pages of **your own** signed-in session, the same way you would in a browser, at a slow pace (hourly, with pauses between pages). Automated access may still go against [Amazon's Conditions of Use](https://www.amazon.com/gp/help/customer/display.html?nodeId=508088). Use it for personal purposes and at your own risk. Not affiliated with Amazon.

## Reliability

- **No false alerts from a broken page.** If a product page has no price and no "unavailable" message, the reading is skipped instead of being treated as out of stock. If the cart page doesn't look like a cart, your product list is left untouched.
- **Broken-scraper alert.** After 3 checks in a row that can't read Amazon, you get one email (and a Windows notification) saying the page layout probably changed, and another one when it works again.
- **Signed-out alert.** If Amazon ends your session or asks for a CAPTCHA, you get an email, since the app usually runs hidden in the tray.
- **Retries.** A failed check is retried after 5, 15 and 30 minutes before going back to the normal interval.

## When Amazon changes its pages

All CSS selectors are in one file: [`src/main/scraper/extractors.ts`](src/main/scraper/extractors.ts).

The tests in `tests/extractors.test.ts` run those selectors against real Amazon pages saved in `tests/fixtures/`. To refresh them from your own session (close the app first):

```bash
npm run fixtures -- B0CTR557NJ
```

The script keeps only the elements the selectors read and replaces the account name, so no personal data is saved. Still, **review the files before committing them**. Then run `npm test` to see exactly which selector broke.

## Project structure

```
src/
├─ shared/            types + pricing logic (base/threshold rules, price parsing)
├─ main/              Electron main process (the "backend")
│  ├─ index.ts        window, tray, IPC, single-instance lock
│  ├─ tracker.ts      the check loop: cart → product pages → offers → alerts
│  ├─ scraper/        hidden browser window + in-page extractors
│  ├─ db/             SQLite schema and queries
│  ├─ notify/         Resend email + Windows notifications
│  ├─ health.ts       broken-scraper / signed-out alerts and retry delays
│  ├─ settings.ts     settings + encrypted API key
│  └─ exchange.ts     COP/USD rate
├─ preload/           the safe bridge exposed to the UI as window.api
└─ renderer/          React UI: products, price chart, settings
scripts/              capture-fixtures.cjs (saves anonymized Amazon pages for tests)
tests/                pricing rules + scraper tests against saved Amazon pages
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit tests (Vitest), including the scraper against saved Amazon pages |
| `npm run fixtures -- <ASIN>` | Save fresh, anonymized Amazon pages for the scraper tests |
| `npm run typecheck` | TypeScript check |
| `npm run dist` | Build the Windows installer |

## Icon

Put your icon files in [`resources/`](resources/README.md) (`icon.ico`, `icon.png`, `tray.png`); the build and the running app pick them up. Without them the app uses a placeholder.

## Releases and automatic updates

The installed app checks [GitHub Releases](https://github.com/PedroGraph/price-tracker/releases) on startup and every 6 hours, downloads new versions in the background, and offers **Restart to update**.

To publish a version:

1. Bump `version` in `package.json` (it must be higher than the installed one) and commit.
2. With a GitHub token that can write to the repo (see below), run in PowerShell:

   ```powershell
   $env:GH_TOKEN = "<your token>"; npm run release
   ```

   This builds the installer and publishes it, together with `latest.yml`, as a GitHub release. Installed apps pick it up on their next check or when you click **Check for updates**, then offer **Restart to update**.

**Token:** GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained tokens* → Generate. Repository access: only `price-tracker`; permission **Contents: Read and write**. Keep it out of the repo.

Updates need the repository to be **public**. With a private repo the app would need a token inside the installer, which it deliberately doesn't ship, so update checks just report an error.

## License

MIT
