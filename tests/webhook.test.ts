import { describe, expect, it } from 'vitest'
import { isWebhookUrl, webhookKind, webhookPayload } from '../src/shared/webhook'

const msg = {
  title: 'Price dropped',
  lines: ['MacBook Air', '$999 → $899', 'Seller: Amazon'],
  url: 'https://www.amazon.com/dp/B0TEST',
  image: 'https://m.media-amazon.com/images/I/test.jpg'
}

describe('isWebhookUrl', () => {
  it('accepts http and https only', () => {
    expect(isWebhookUrl('https://discord.com/api/webhooks/1/abc')).toBe(true)
    expect(isWebhookUrl('http://192.168.1.10:8123/api/webhook/light')).toBe(true)
    expect(isWebhookUrl('  https://ntfy.sh/my-topic  ')).toBe(true)
  })

  it('rejects anything that is not a web address', () => {
    expect(isWebhookUrl('javascript:alert(1)')).toBe(false)
    expect(isWebhookUrl('ftp://example.com/hook')).toBe(false)
    expect(isWebhookUrl('discord.com/api/webhooks')).toBe(false)
    expect(isWebhookUrl('')).toBe(false)
  })
})

describe('webhookKind', () => {
  it('recognises the service from the host', () => {
    expect(webhookKind('https://discord.com/api/webhooks/123/token')).toBe('discord')
    expect(webhookKind('https://discordapp.com/api/webhooks/123/token')).toBe('discord')
    expect(webhookKind('https://hooks.slack.com/services/T/B/X')).toBe('slack')
    expect(webhookKind('https://ntfy.sh/price-tracker')).toBe('ntfy')
    expect(webhookKind('https://ntfy.example.com/price-tracker')).toBe('ntfy')
  })

  it('falls back to generic JSON for Home Assistant and unknown servers', () => {
    expect(webhookKind('https://homeassistant.local:8123/api/webhook/abc')).toBe('json')
    expect(webhookKind('not a url')).toBe('json')
  })
})

describe('webhookPayload', () => {
  it('sends Discord an embed with the link and picture', () => {
    const { headers, body } = webhookPayload('discord', msg)
    const json = JSON.parse(body) as { embeds: { title: string; description: string; url: string; thumbnail: { url: string } }[] }
    expect(headers['Content-Type']).toBe('application/json')
    expect(json.embeds[0].title).toBe('Price dropped')
    expect(json.embeds[0].description).toBe('MacBook Air\n$999 → $899\nSeller: Amazon')
    expect(json.embeds[0].url).toBe(msg.url)
    expect(json.embeds[0].thumbnail.url).toBe(msg.image)
  })

  it('links the title in Slack', () => {
    const { body } = webhookPayload('slack', msg)
    const json = JSON.parse(body) as { text: string }
    expect(json.text).toContain(`<${msg.url}|Price dropped>`)
    expect(json.text).toContain('$999 → $899')
  })

  it('sends ntfy plain text with a high priority and a click link', () => {
    const { headers, body } = webhookPayload('ntfy', msg)
    expect(headers.Priority).toBe('high')
    expect(headers['Content-Type']).toContain('text/plain')
    expect(headers.Click).toBe(msg.url)
    expect(body).toBe('Price dropped\nMacBook Air\n$999 → $899\nSeller: Amazon')
  })

  it('sends generic JSON with every field, for Home Assistant automations', () => {
    const { body } = webhookPayload('json', msg)
    expect(JSON.parse(body)).toEqual({
      app: 'Price Tracker',
      title: 'Price dropped',
      message: 'MacBook Air\n$999 → $899\nSeller: Amazon',
      url: msg.url,
      image: msg.image
    })
  })

  it('works without a link or picture', () => {
    const bare = { title: 'Out of stock', lines: ['MacBook Air'] }
    expect(JSON.parse(webhookPayload('json', bare).body).url).toBeNull()
    expect(webhookPayload('ntfy', bare).headers.Click).toBeUndefined()
    expect(JSON.parse(webhookPayload('discord', bare).body).embeds[0].url).toBeUndefined()
  })
})
