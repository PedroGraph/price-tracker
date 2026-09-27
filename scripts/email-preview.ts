/**
 * Writes preview/email-<lang>.html with sample alerts, to check the email design
 * without sending anything:  npm run email:preview
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { alertEmail, type EmailAlert } from '../src/main/notify/emailTemplate'

const airpods = {
  title: 'Apple AirPods Pro (3.ª generación) (Renovado) — Traducción en vivo, detección de frecuencia cardíaca, audio espacial, carga USB-C',
  image: 'https://m.media-amazon.com/images/I/61solmQSSlL._AC_SL1500_.jpg',
  url: 'https://www.amazon.com/dp/B0FRB8FXK5',
  inCart: true
}

const samples: EmailAlert[] = [
  { ...airpods, type: 'price_up', seller: 'Hybrid IT', oldPrice: 169.99, newPrice: 189, detail: null },
  { ...airpods, type: 'price_down', seller: 'Chubbiestech', oldPrice: 189, newPrice: 169.99, detail: null, inCart: false },
  { ...airpods, type: 'coupon_added', seller: 'Amazon.com', oldPrice: null, newPrice: 169.99, detail: 'Apply $20 coupon → $149.99' },
  { ...airpods, type: 'out_of_stock', seller: null, oldPrice: null, newPrice: null, detail: null }
]

mkdirSync('preview', { recursive: true })
for (const lang of ['es', 'en'] as const) {
  writeFileSync(`preview/email-${lang}.html`, alertEmail(samples, 3257.15, lang))
  console.log(`preview/email-${lang}.html`)
}
