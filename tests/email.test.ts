import { describe, expect, it } from 'vitest'
import { alertEmail, messageEmail, type EmailAlert } from '../src/main/notify/emailTemplate'

const base: EmailAlert = {
  type: 'price_up',
  title: 'AirPods <script>alert(1)</script> & "Pro"',
  image: null,
  seller: 'Hybrid IT',
  url: 'https://www.amazon.com/dp/B0FRB8FXK5?smid=A2AGRXPN4RKYKO',
  inCart: true,
  oldPrice: 169.99,
  newPrice: 189,
  detail: null
}

describe('alert email', () => {
  it('matches the design pieces in Spanish', () => {
    const html = alertEmail([base], 3257.15, 'es')
    expect(html).toContain('Subió un 11,2 %')
    expect(html).toContain('El precio subió')
    expect(html).toContain('Vendido por Hybrid IT')
    expect(html).toContain('$169.99')
    expect(html).toContain('$189.00')
    expect(html).toContain('COP')
    expect(html).toContain('Ver en tu carrito de Amazon')
  })

  it('escapes product text coming from Amazon', () => {
    const html = alertEmail([base], null, 'en')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&#60;script&#62;')
  })

  it('links products outside the cart to the seller offer', () => {
    const html = alertEmail([{ ...base, inCart: false, type: 'price_down', oldPrice: 189, newPrice: 169.99 }], null, 'en')
    expect(html).toContain('href="https://www.amazon.com/dp/B0FRB8FXK5?smid=A2AGRXPN4RKYKO"')
    expect(html).toContain('Down 10.1%')
    expect(html).toContain('View on Amazon')
  })

  it('shows only the current state for stock alerts', () => {
    const html = alertEmail([{ ...base, type: 'out_of_stock', oldPrice: null, newPrice: null }], null, 'es')
    expect(html).toContain('Se agotó')
    expect(html).toContain('No disponible')
    expect(html).not.toContain('Antes')
  })

  it('wraps warnings and summaries in the same layout', () => {
    const html = messageEmail('Test', '<p>Hi</p>', 'es')
    expect(html).toContain('Price Tracker')
    expect(html).toContain('alertas enviadas con tu propia cuenta de Resend')
  })
})
