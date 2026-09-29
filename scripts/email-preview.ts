/**
 * Writes preview/email-<lang>.html (sample alerts) and preview/digest-<lang>.html (a summary), to check the email design
 * without sending anything:  npm run email:preview
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { alertEmail, digestEmail, type EmailAlert } from '../src/main/notify/emailTemplate'

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

const img = (id: string): string => `https://m.media-amazon.com/images/I/${id}._AC_SL500_.jpg`
const digestRows = [
  { title: airpods.title, image: airpods.image, url: airpods.url, price: 169.99, before: 189, lowest: 169.99, available: true, coupon: null },
  { title: 'Apple MacBook Pro 2023 con chip Apple M3 de 14 pulgadas, 8 GB de RAM, SSD de 512 GB gris espacial (renovado)', image: img('61RJn0ofUsL'), url: 'https://www.amazon.com/dp/B0CM5JV268', price: 1046.15, before: 1074.68, lowest: 1046.15, available: true, coupon: null },
  { title: 'PlayStation 5 Slim Digital with 1TB SSD Storage, Wireless Dualsense Controller - PS5 Gaming System, White (Renewed)', image: img('51eOztNdCkL'), url: 'https://www.amazon.com/dp/B0CL5KNB9M', price: 549.99, before: 584.09, lowest: 549.99, available: true, coupon: 'Save 5%' },
  { title: 'Reproductor de discos de vinilo con altavoces, tocadiscos de 3 velocidades con Bluetooth', image: null, url: 'https://www.amazon.com/dp/B0B1', price: null, before: null, lowest: null, available: false, coupon: null },
  { title: 'Tapo TP-Link Tapo SolarCam C402 Kit, cámara solar para exteriores con batería y base de panel solar', image: img('61Lh3AdyJ9L'), url: 'https://www.amazon.com/dp/B0C', price: 59.99, before: 59.99, lowest: 59.99, available: true, coupon: null },
  { title: 'Xbox Series X Console (Renewed)', image: null, url: 'https://www.amazon.com/dp/B0D', price: 629.99, before: null, lowest: 629.99, available: true, coupon: null }
]
writeFileSync('preview/digest-es.html', digestEmail({ title: 'Resumen diario: 6 productos, 4 alertas', intro: 'Tus productos rastreados en las últimas 24 horas:', alerts: 4, rows: digestRows }, 3335.9, 'es'))
console.log('preview/digest-es.html')
