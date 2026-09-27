/**
 * Alert email layout. Email clients ignore stylesheets, web fonts and SVG, so this is
 * table-based HTML with inline styles only. Pure (no Electron), so it can be tested and
 * previewed with `npm run email:preview`.
 */
import { formatCop, formatUsd } from '@shared/pricing'
import { translate, type Lang } from '@shared/i18n'
import type { EventType } from '@shared/types'

export const LOGO_URL = 'https://raw.githubusercontent.com/PedroGraph/price-tracker/main/resources/icon.png'
const CART_URL = 'https://www.amazon.com/gp/cart/view.html'

const C = {
  page: '#efeee9',
  card: '#ffffff',
  line: '#e6e4dd',
  text: '#1c1c1a',
  muted: '#75736c',
  faint: '#a3a19a',
  panel: '#faf9f6',
  teal: '#0e8a7b',
  tealSoft: '#e2f1ed',
  amber: '#b8741a',
  amberSoft: '#fbeed8',
  red: '#d23b30',
  redSoft: '#fbe5e2',
  button: '#1c1c1a'
}
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono','Courier New',monospace"

export interface EmailAlert {
  type: EventType
  title: string
  image: string | null
  seller: string | null
  /** Where the button goes: the seller's offer, or the product page. */
  url: string
  /** Cart products link to the cart, as in the app. */
  inCart: boolean
  oldPrice: number | null
  newPrice: number | null
  /** Extra line for coupon / deal / target alerts. */
  detail: string | null
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

type Tone = 'up' | 'down' | 'bad' | 'good'
const TONE: Record<Tone, { fg: string; bg: string }> = {
  up: { fg: C.amber, bg: C.amberSoft },
  down: { fg: C.teal, bg: C.tealSoft },
  good: { fg: C.teal, bg: C.tealSoft },
  bad: { fg: C.red, bg: C.redSoft }
}

/** Pill text, heading and colour for each alert type. */
function describe(a: EmailAlert, t: (s: string, v?: Record<string, string | number>) => string, lang: Lang) {
  const pct =
    a.oldPrice && a.newPrice !== null
      ? Math.abs(((a.newPrice - a.oldPrice) / a.oldPrice) * 100).toLocaleString(lang === 'es' ? 'es-CO' : 'en-US', {
          maximumFractionDigits: 1
        })
      : null
  switch (a.type) {
    case 'price_up':
      return { tone: 'up' as Tone, pill: `▲ ${t('Up {pct}%', { pct: pct ?? '?' })}`, heading: t('The price went up') }
    case 'price_down':
      return { tone: 'down' as Tone, pill: `▼ ${t('Down {pct}%', { pct: pct ?? '?' })}`, heading: t('The price dropped') }
    case 'out_of_stock':
      return { tone: 'bad' as Tone, pill: `● ${t('Out of stock')}`, heading: t('It ran out of stock') }
    case 'back_in_stock':
      return { tone: 'good' as Tone, pill: `● ${t('Back in stock')}`, heading: t('It is available again') }
    case 'target_reached':
      return { tone: 'good' as Tone, pill: `✓ ${t('Target reached')}`, heading: t('It reached your target price') }
    case 'all_time_low':
      return { tone: 'good' as Tone, pill: `▼ ${t('Lowest ever')}`, heading: t('Lowest price since tracking started') }
    case 'coupon_added':
      return { tone: 'good' as Tone, pill: `% ${t('Coupon')}`, heading: t('A coupon is available') }
    case 'deal_started':
      return { tone: 'up' as Tone, pill: `★ ${t('Deal started')}`, heading: t('A deal just started') }
    default:
      return { tone: 'good' as Tone, pill: t('Tracking started'), heading: t('Tracking started') }
  }
}

function priceBlock(a: EmailAlert, tone: Tone, rate: number | null, t: (s: string) => string): string {
  const cop = (usd: number): string => (rate ? `${formatCop(usd * rate).replace(/\s/g, '')} COP` : '&nbsp;')
  const now =
    a.newPrice === null
      ? `<div style="font:600 20px ${SANS};color:${C.muted}">${esc(t('Unavailable'))}</div>`
      : `<div style="font:700 36px/1.1 ${MONO};color:${C.text};letter-spacing:-0.5px">${formatUsd(a.newPrice)}</div>
         <div style="font:12px ${MONO};color:${C.faint};margin-top:6px">${cop(a.newPrice)}</div>`
  const showBefore = a.oldPrice !== null && a.newPrice !== null && a.oldPrice !== a.newPrice
  const before = showBefore
    ? `<td align="center" style="padding:0 8px">
         <div style="font:13px ${SANS};color:${C.muted};margin-bottom:4px">${esc(t('Before'))}</div>
         <div style="font:500 20px ${MONO};color:${C.faint};text-decoration:line-through">${formatUsd(a.oldPrice!)}</div>
         <div style="font:12px ${MONO};color:${C.faint};margin-top:6px">${cop(a.oldPrice!)}</div>
       </td>
       <td align="center" style="padding:0 8px;font:18px ${SANS};color:${TONE[tone].fg}">→</td>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};border-radius:14px">
    <tr><td align="center" style="padding:22px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        ${before}
        <td align="center" style="padding:0 8px">
          <div style="font:600 13px ${SANS};color:${TONE[tone].fg};margin-bottom:4px">${esc(t('Now'))}</div>
          ${now}
        </td>
      </tr></table>
    </td></tr>
  </table>`
}

function card(a: EmailAlert, rate: number | null, lang: Lang): string {
  const t = (s: string, v?: Record<string, string | number>): string => translate(lang, s, v)
  const d = describe(a, t, lang)
  const tone = TONE[d.tone]
  const image = a.image
    ? `<img src="${esc(a.image)}" width="52" height="52" alt="" style="display:block;width:52px;height:52px;object-fit:contain;background:#fff;border:1px solid ${C.line};border-radius:12px">`
    : `<div style="width:52px;height:52px;background:${C.panel};border:1px solid ${C.line};border-radius:12px"></div>`
  const button = a.inCart ? t('View in your Amazon cart') : t('View on Amazon')
  const footer = a.inCart
    ? t('We keep checking this product in your Amazon cart. You can change the alert threshold or stop tracking it from the app.')
    : t('We keep checking this product. You can change the alert threshold or stop tracking it from the app.')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:20px">
  <tr><td style="padding:32px 36px">
    <span style="display:inline-block;background:${tone.bg};color:${tone.fg};font:600 13px ${SANS};padding:6px 14px;border-radius:999px">${esc(d.pill)}</span>
    <h1 style="margin:16px 0 22px;font:700 22px/1.3 ${SANS};color:${C.text}">${esc(d.heading)}</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      <td width="52" valign="top">${image}</td>
      <td valign="top" style="padding-left:14px">
        <div style="font:600 15px/1.4 ${SANS};color:${C.text}">${esc(a.title)}</div>
        ${a.seller ? `<div style="font:13px ${SANS};color:${C.muted};margin-top:4px">${esc(t('Sold by {seller}', { seller: a.seller }))}</div>` : ''}
        ${a.detail ? `<div style="font:600 13px ${SANS};color:${tone.fg};margin-top:4px">${esc(a.detail)}</div>` : ''}
      </td>
    </tr></table>
    <div style="height:22px"></div>
    ${priceBlock(a, d.tone, rate, t)}
    <div style="height:24px"></div>
    <a href="${esc(a.inCart ? CART_URL : a.url)}" style="display:inline-block;background:${C.button};color:#ffffff;font:600 14px ${SANS};text-decoration:none;padding:13px 22px;border-radius:10px">${esc(button)} →</a>
    <div style="border-top:1px solid ${C.line};margin:26px 0 18px"></div>
    <p style="margin:0;font:13px/1.6 ${SANS};color:${C.muted}">${esc(footer)}</p>
  </td></tr>
</table>`
}

/** Header, body and footer shared by every email (alerts, summaries, warnings). */
export function emailShell(inner: string, lang: Lang): string {
  const t = (s: string): string => translate(lang, s)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}">
  <tr><td align="center" style="padding:36px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
      <tr><td style="padding:0 4px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td><img src="${LOGO_URL}" width="30" height="30" alt="" style="display:block;border-radius:8px"></td>
          <td style="padding-left:10px;font:700 15px ${SANS};color:${C.text}">Price Tracker</td>
        </tr></table>
      </td></tr>
      <tr><td>${inner}</td></tr>
      <tr><td align="center" style="padding:22px 0 0;font:12px ${SANS};color:${C.faint}">
        Price Tracker · ${esc(t('alerts sent with your own Resend account'))}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

export function alertEmail(alerts: EmailAlert[], rate: number | null, lang: Lang): string {
  return emailShell(alerts.map((a) => card(a, rate, lang)).join('<div style="height:16px"></div>'), lang)
}

/** A plain card for summaries and warnings, inside the same shell. */
export function messageEmail(title: string, bodyHtml: string, lang: Lang): string {
  return emailShell(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:20px">
      <tr><td style="padding:32px 36px;font:14px/1.6 ${SANS};color:${C.text}">
        <h1 style="margin:0 0 16px;font:700 20px/1.3 ${SANS};color:${C.text}">${esc(title)}</h1>
        ${bodyHtml}
      </td></tr>
    </table>`,
    lang
  )
}
