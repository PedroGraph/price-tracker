import { describe, expect, it } from 'vitest'
import { isAllowedExternal, isAmazonUrl } from '../src/shared/urls'

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
