import { webhookKind, webhookPayload, type WebhookKind, type WebhookMessage } from '@shared/webhook'
import { getSecret, getSettings, tr } from '../settings'

/**
 * One saved webhook URL, used by every alert. The service is worked out from the host,
 * so the same setting works for Discord, Slack, ntfy and Home Assistant.
 */
function saved(): { url: string; kind: WebhookKind } | null {
  const url = getSecret('webhookUrl')
  return url ? { url, kind: webhookKind(url) } : null
}

async function post(url: string, kind: WebhookKind, msg: WebhookMessage): Promise<void> {
  const { headers, body } = webhookPayload(kind, msg)
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
  // The URL is a secret (Slack and Discord put the token in it): only the status is reported.
  if (!res.ok) throw new Error(`Webhook error ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

/** Resolves to false, sending nothing, when no URL is saved or webhooks are turned off. */
export async function sendWebhook(msg: WebhookMessage, force = false): Promise<boolean> {
  const target = saved()
  if (!target || (!getSettings().webhookEnabled && !force)) return false
  await post(target.url, target.kind, msg)
  return true
}

/** Sends a sample message and returns which service it went to. */
export async function sendWebhookTest(): Promise<WebhookKind> {
  const target = saved()
  if (!target) throw new Error('Add your webhook URL first.')
  await post(target.url, target.kind, {
    title: tr('Price Tracker test'),
    lines: [tr('Webhook alerts are working. 🎉')]
  })
  return target.kind
}
