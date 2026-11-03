// @vitest-environment node
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Market, MarketQuote } from './market.ts'
import { createFcmSender, createPush, serviceAccountJson, type PushAlert } from './push.ts'
import type { Store } from './store.ts'
import { createTestStore } from './testStore.ts'

const quote = (id: string, price: string): MarketQuote => ({ id, price, currency: 'THB', at: '2026-11-02T03:00:00.000Z', previousClose: null, previousCloseAt: null, source: 'Yahoo' })
const alert = (id: string, instrumentId: string, direction: PushAlert['direction'], price: string): PushAlert => ({ id, instrumentId, direction, price })

let store: Store
let userId: string
const sent: { token: string; title: string; body: string }[] = []
const market = { quotes: async (ids: string[]) => ids.flatMap((id) => (id === 'SET:PTT' ? [quote(id, '34.5')] : id === 'US:NVDA' ? [quote(id, '150')] : [])) } as Pick<Market, 'quotes'>

beforeEach(async () => {
  store = await createTestStore()
  userId = (await store.addUser({ email: 'a@x.io', salt: 's', hash: 'h', keys: {} })).id
  sent.length = 0
})

const push = () => createPush({ store, market, send: async (token, title, body) => void sent.push({ token, title, body }) })

describe('price alert pushes', () => {
  it('sends one push for each crossed alert and then forgets it', async () => {
    await push().register(userId, { token: 'tok-1', platform: 'ios', alerts: [alert('a1', 'SET:PTT', 'below', '35'), alert('a2', 'US:NVDA', 'above', '200')] })
    expect(await push().check()).toBe(1)
    expect(sent).toEqual([{ token: 'tok-1', title: 'JOD: PTT ต่ำกว่า 35', body: 'ราคาล่าสุด 34.5' }])
    expect((await store.pushDevices()).map((d) => d.alerts.map((a) => a.id))).toEqual([['a2']])
    expect(await push().check()).toBe(0)
  })

  it('replaces what a device asked for, and forgets the device when it opts out', async () => {
    await push().register(userId, { token: 'tok-1', platform: 'android', alerts: [alert('a1', 'SET:PTT', 'below', '35')] })
    await push().register(userId, { token: 'tok-1', platform: 'android', alerts: [alert('a3', 'US:NVDA', 'below', '100')] })
    expect((await store.pushDevices()).map((d) => d.alerts.map((a) => a.id))).toEqual([['a3']])
    await push().unregister(userId, 'tok-1')
    expect(await store.pushDevices()).toEqual([])
  })
})

describe('serviceAccountJson', () => {
  it('takes the JSON as it is, as hosting secrets hold it', () => {
    expect(serviceAccountJson(' {"project_id":"jod"} ', () => 'unused')).toBe('{"project_id":"jod"}')
  })

  it('reads the key file a path points at, which a .env file can hold where the JSON itself breaks', () => {
    const read: string[] = []
    const json = serviceAccountJson('/keys/jod-firebase.json', (path) => {
      read.push(path)
      return '{"project_id":"jod"}\n'
    })
    expect([json, read]).toEqual(['{"project_id":"jod"}\n', ['/keys/jod-firebase.json']])
  })
})

describe('FCM sender', () => {
  it('signs in with the service account and sends a notification to the token', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const account = JSON.stringify({
      project_id: 'jod-test',
      client_email: 'push@jod-test.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://oauth2.googleapis.com/token',
    })
    const calls: { url: string; body: string; auth: string | null }[] = []
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body), auth: new Headers(init?.headers).get('authorization') })
      return String(url).includes('oauth2') ? new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 })) : new Response('{}')
    }) as typeof fetch
    const send = createFcmSender(account, fetchFn, () => Date.parse('2026-11-02T03:00:00Z'))
    await send('tok-1', 'JOD: PTT ต่ำกว่า 35', 'ราคาล่าสุด 34.5')
    await send('tok-2', 't', 'b')

    const assertion = new URLSearchParams(calls[0].body).get('assertion')!
    const [header, claims, signature] = assertion.split('.')
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${claims}`)
    expect(verifier.verify(createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })), Buffer.from(signature, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ iss: 'push@jod-test.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging' })

    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1)
    const message = calls[1]
    expect(message.url).toBe('https://fcm.googleapis.com/v1/projects/jod-test/messages:send')
    expect(message.auth).toBe('Bearer ya29.test')
    expect(JSON.parse(message.body)).toEqual({ message: { token: 'tok-1', notification: { title: 'JOD: PTT ต่ำกว่า 35', body: 'ราคาล่าสุด 34.5' } } })
  })
})
