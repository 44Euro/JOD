import { beforeEach, describe, expect, it } from 'vitest'
import type { PriceAlert } from '../domain/types'
import { PUSH_TOKEN_KEY, disablePush, enablePush, syncPushAlerts, type PushPlugin } from './push'

const alert = (id: string, extra: Partial<PriceAlert> = {}): PriceAlert => ({ id, instrumentId: 'SET:PTT', direction: 'below', price: '35', createdAt: '2026-11-01T00:00:00.000Z', ...extra })
const where = () => ({ server: 'http://jod.test', token: 'session' })

function fakePlugin(permission: 'granted' | 'denied' = 'granted'): PushPlugin & { registered: number } {
  let onToken: (token: { value: string }) => void = () => {}
  const plugin = {
    registered: 0,
    requestPermissions: async () => ({ receive: permission }),
    register: async () => {
      plugin.registered += 1
      onToken({ value: 'device-token' })
    },
    addListener: async (_event: 'registration', listener: (token: { value: string }) => void) => {
      onToken = listener
      return { remove: async () => {} }
    },
  }
  return plugin
}

function fakeServer(status = 204) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url), body: JSON.parse(String(init?.body ?? 'null')), auth: new Headers(init?.headers).get('authorization') })
    return new Response(null, { status })
  }) as typeof fetch
  return { fetchFn, calls }
}

beforeEach(() => localStorage.removeItem(PUSH_TOKEN_KEY))

describe('push opt-in', () => {
  it('asks permission, registers the phone and sends the alerts not yet fired', async () => {
    const plugin = fakePlugin()
    const server = fakeServer()
    expect(await enablePush([alert('a1'), alert('a2', { firedAt: '2026-11-02T00:00:00.000Z' })], { plugin, platform: 'ios', fetchFn: server.fetchFn, where })).toBe('on')
    expect(server.calls).toEqual([
      {
        method: 'POST',
        url: 'http://jod.test/api/push/register',
        auth: 'Bearer session',
        body: { token: 'device-token', platform: 'ios', alerts: [{ id: 'a1', instrumentId: 'SET:PTT', direction: 'below', price: '35' }] },
      },
    ])
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe('device-token')
  })

  it('stays off when the person refuses or the server has no push yet', async () => {
    expect(await enablePush([], { plugin: fakePlugin('denied'), platform: 'ios', fetchFn: fakeServer().fetchFn, where })).toBe('denied')
    expect(await enablePush([], { plugin: fakePlugin(), platform: 'android', fetchFn: fakeServer(503).fetchFn, where })).toBe('server-off')
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull()
  })

  it('sends the alerts again when they change, only while opted in', async () => {
    const server = fakeServer()
    await syncPushAlerts([alert('a1')], { platform: 'ios', fetchFn: server.fetchFn, where })
    expect(server.calls).toHaveLength(0)
    localStorage.setItem(PUSH_TOKEN_KEY, 'device-token')
    await syncPushAlerts([alert('a1')], { platform: 'ios', fetchFn: server.fetchFn, where })
    expect(server.calls.map((c) => c.method)).toEqual(['POST'])
  })

  it('removes the registration when the person opts out', async () => {
    localStorage.setItem(PUSH_TOKEN_KEY, 'device-token')
    const server = fakeServer()
    await disablePush({ fetchFn: server.fetchFn, where })
    expect(server.calls.map((c) => [c.method, c.body])).toEqual([['DELETE', { token: 'device-token' }]])
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBeNull()
  })
})
