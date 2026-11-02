import { readLocal, writeLocal } from '../ai/apiKey'
import type { PriceAlert } from '../domain/types'
import { readSync } from '../sync/state'

// Price-alert pushes are opt-in per phone. Opting in hands the JOD server this phone's push token and, for each alert
// not yet fired, its symbol, direction and price; the server knows nothing else about the portfolio.
export const PUSH_TOKEN_KEY = 'jod-push-token'
const REGISTER_TIMEOUT_MS = 15_000

export interface PushPlugin {
  requestPermissions(): Promise<{ receive: string }>
  register(): Promise<void>
  addListener(event: 'registration', listener: (token: { value: string }) => void): Promise<{ remove(): Promise<void> }>
}

type Where = () => { server: string; token: string } | null

interface Deps {
  plugin?: PushPlugin
  platform?: string
  fetchFn?: typeof fetch
  where?: Where
}

const session: Where = () => {
  const state = readSync()
  return state ? { server: state.server, token: state.token } : null
}

async function defaultPlugin(): Promise<PushPlugin> {
  return (await import('@capacitor/push-notifications')).PushNotifications
}

async function defaultPlatform(): Promise<string> {
  return (await import('@capacitor/core')).Capacitor.getPlatform()
}

function call(method: 'POST' | 'DELETE', body: unknown, { fetchFn = (i, o) => fetch(i, o), where = session }: Deps): Promise<Response | null> {
  const at = where()
  if (!at) return Promise.resolve(null)
  return fetchFn(`${at.server.replace(/\/+$/, '')}/api/push/register`, {
    method,
    headers: { authorization: `Bearer ${at.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const targets = (alerts: readonly PriceAlert[]) =>
  alerts.filter((a) => !a.firedAt).map(({ id, instrumentId, direction, price }) => ({ id, instrumentId, direction, price }))

export type PushResult = 'on' | 'denied' | 'server-off' | 'failed'

export async function enablePush(alerts: readonly PriceAlert[], deps: Deps = {}): Promise<PushResult> {
  const plugin = deps.plugin ?? (await defaultPlugin())
  const platform = deps.platform ?? (await defaultPlatform())
  if ((await plugin.requestPermissions()).receive !== 'granted') return 'denied'
  let received: (token: string) => void = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const token = new Promise<string>((resolve, reject) => {
    received = resolve
    timer = setTimeout(() => reject(new Error('no push token')), REGISTER_TIMEOUT_MS)
  })
  const listener = await plugin.addListener('registration', (t) => received(t.value))
  try {
    await plugin.register()
    const value = await token
    const res = await call('POST', { token: value, platform, alerts: targets(alerts) }, deps)
    if (res?.status === 503) return 'server-off'
    if (!res?.ok) return 'failed'
    writeLocal(PUSH_TOKEN_KEY, value)
    return 'on'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timer)
    await listener.remove()
  }
}

// Sent again whenever the alerts change, so the server watches what the person has now.
export async function syncPushAlerts(alerts: readonly PriceAlert[], deps: Deps = {}): Promise<void> {
  const token = readLocal(PUSH_TOKEN_KEY)
  if (!token) return
  await call('POST', { token, platform: deps.platform ?? (await defaultPlatform()), alerts: targets(alerts) }, deps).catch(() => null)
}

export async function disablePush(deps: Deps = {}): Promise<void> {
  const token = readLocal(PUSH_TOKEN_KEY)
  if (token) await call('DELETE', { token }, deps).catch(() => null)
  writeLocal(PUSH_TOKEN_KEY, '')
}
