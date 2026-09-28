import { describe, expect, it } from 'vitest'
import { isAllowedExternal, isAmazonUrl, relatedQuery, searchUrl } from '../src/shared/urls'

describe('isAmazonUrl', () => {
  it('accepts amazon.com and its subdomains over https', () => {
    expect(isAmazonUrl('https://www.amazon.com/gp/cart/view.html')).toBe(true)
    expect(isAmazonUrl('https://amazon.com/ap/signin?x=1')).toBe(true)
  })

  it('rejects look-alikes, other schemes and other sites', () => {
    expect(isAmazonUrl('https://amazon.com.evil.io/ap/signin')).toBe(false)
    expect(isAmazonUrl('https://evilamazon.com/')).toBe(false)
    expect(isAmazonUrl('http://www.amazon.com/')).toBe(false)
    expect(isAmazonUrl('file:///C:/Windows/win.ini')).toBe(false)
    expect(isAmazonUrl('javascript:alert(1)')).toBe(false)
    expect(isAmazonUrl('not a url')).toBe(false)
  })
})

describe('isAllowedExternal', () => {
  it('opens only known sites over https', () => {
    expect(isAllowedExternal('https://www.amazon.com/dp/B0FRB8FXK5?smid=A1')).toBe(true)
    expect(isAllowedExternal('https://github.com/PedroGraph/price-tracker/releases')).toBe(true)
    expect(isAllowedExternal('https://resend.com/emails')).toBe(true)
    expect(isAllowedExternal('https://t.me/my_bot')).toBe(true)
    expect(isAllowedExternal('https://phishing.example/amazon.com')).toBe(false)
    expect(isAllowedExternal('ms-settings:privacy')).toBe(false)
    expect(isAllowedExternal('file:///C:/Users')).toBe(false)
  })
})

describe('searchUrl', () => {
  it('builds the search with filters, sort and a USD price range', () => {
    const url = new URL(searchUrl({ query: ' ps5 ', rh: 'p_123:110955,p_36:100-200', sort: 'price-asc-rank', minPrice: 100, maxPrice: 300.5 })!)
    expect(url.origin + url.pathname).toBe('https://www.amazon.com/s')
    expect(url.searchParams.get('k')).toBe('ps5')
    expect(url.searchParams.get('rh')).toBe('p_123:110955,p_36:10000-30050')
    expect(url.searchParams.get('s')).toBe('price-asc-rank')
  })

  it('rejects odd input', () => {
    expect(searchUrl({ query: '' })).toBeNull()
    expect(searchUrl({ query: 'x', rh: 'a&b=c' })).toBeNull()
    expect(searchUrl({ query: 'x', sort: '../evil' })).toBeNull()
  })
})

describe('relatedQuery', () => {
  it('keeps the product name: before commas and brackets, without condition words, six words at most', () => {
    expect(relatedQuery('Apple MacBook Pro 2023 con chip Apple M3 de 14 pulgadas, 8 GB de RAM (renovado)')).toBe('Apple MacBook Pro 2023 con chip')
    expect(relatedQuery('Apple AirPods Pro (3.ª generación) (Renovado) | Traducción en vivo')).toBe('Apple AirPods Pro')
    expect(relatedQuery('Tapo TP-Link Tapo SolarCam C402 Kit, cámara solar')).toBe('Tapo TP-Link Tapo SolarCam C402 Kit')
  })
})
