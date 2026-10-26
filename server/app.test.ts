// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import type { Store } from './store.ts'
import { createTestStore } from './testStore.ts'

let server: Server
let base = ''
let store: Store
let mails: { to: string; text: string }[] = []
const key = (c: string) => c.repeat(64)

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

beforeEach(async () => {
  store = await createTestStore()
  mails = []
  const sendMail = async (to: string, _subject: string, text: string) => void mails.push({ to, text })
  server = createServer(createApp({ store, sendMail, appUrl: 'https://jod.test' }))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('sync server', () => {
  it('signs up once per email and signs in only with the right key', async () => {
    expect((await call('POST', '/api/signup', { email: 'A@x.io', loginKey: key('a') })).status).toBe(201)
    expect((await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('b') })).status).toBe(409)
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('b') })).status).toBe(401)
    const ok = await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('a') })
    expect(ok.status).toBe(200)
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/)
    const stored = await store.findUser('a@x.io')
    expect(JSON.stringify(stored)).not.toContain(key('a'))
    expect(await store.sessionUser(ok.body.token)).toBeNull()
  })

  it('numbers every record written and hands back only what changed after a number', async () => {
    const { body } = await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a') })
    expect((await call('GET', '/api/records?after=0', undefined, body.token)).body).toEqual({ change: 0, records: [], more: false })
    const first = await call('POST', '/api/records', { records: [{ kind: 'account', id: 'acc-1', sealed: 's1' }, { kind: 'transaction', id: 'tx-1', sealed: 's2' }] }, body.token)
    expect(first.body).toEqual({ change: 2 })
    await call('POST', '/api/records', { records: [{ kind: 'account', id: 'acc-1', sealed: 's3' }, { kind: 'transaction', id: 'tx-1', sealed: null }] }, body.token)
    expect((await call('GET', '/api/records?after=0', undefined, body.token)).body.records).toEqual([
      { kind: 'account', id: 'acc-1', sealed: 's3', change: 3 },
      { kind: 'transaction', id: 'tx-1', sealed: null, change: 4 },
    ])
    expect((await call('GET', '/api/records?after=3', undefined, body.token)).body.records.map((r: { id: string }) => r.id)).toEqual(['tx-1'])
    expect((await call('POST', '/api/records', { records: [{ kind: 'nope', id: 'x', sealed: 's' }] }, body.token)).status).toBe(400)
  })

  it('needs a valid session, ends it on sign out, and deletes everything on request', async () => {
    expect((await call('GET', '/api/records')).status).toBe(401)
    const { body } = await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a') })
    await call('POST', '/api/records', { records: [{ kind: 'account', id: 'acc-1', sealed: 's' }] }, body.token)
    expect((await call('DELETE', '/api/account', undefined, body.token)).status).toBe(204)
    expect((await call('GET', '/api/records', undefined, body.token)).status).toBe(401)
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('a') })).status).toBe(401)
  })

  it('slows down repeated sign-in attempts', async () => {
    const statuses = []
    for (let i = 0; i < 12; i += 1) statuses.push((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('c') })).status)
    expect(statuses.slice(-1)).toEqual([429])
  })

  it('hands the sealed keys back on sign-in and lets a signed-in device replace them', async () => {
    const { body } = await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a'), keys: { password: 'sealed-p', recovery: 'sealed-r' } })
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('a') })).body.keys).toEqual({ password: 'sealed-p', recovery: 'sealed-r' })
    expect((await call('PUT', '/api/keys', { keys: { recovery: 'sealed-r2' } }, body.token)).status).toBe(204)
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('a') })).body.keys).toEqual({ password: 'sealed-p', recovery: 'sealed-r2' })
  })

  it('resets the password with an emailed code, keeps the data, and ends every old session', async () => {
    const { body } = await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a'), keys: { password: 'sealed-p', recovery: 'sealed-r' } })
    await call('POST', '/api/records', { records: [{ kind: 'account', id: 'acc-1', sealed: 'sealed-data' }] }, body.token)
    expect((await call('POST', '/api/reset/request', { email: 'nobody@x.io' })).status).toBe(204)
    expect(mails).toEqual([])
    expect((await call('POST', '/api/reset/request', { email: 'A@x.io' })).status).toBe(204)
    expect(mails).toHaveLength(1)
    const code = /([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(mails[0].text)![1]
    expect(mails[0].text).toContain(`https://jod.test/#/reset?email=a%40x.io&code=${code}`)
    expect((await call('POST', '/api/reset/verify', { email: 'a@x.io', code: 'AAAA-AAAA' })).status).toBe(400)
    expect((await call('POST', '/api/reset/verify', { email: 'a@x.io', code: code.toLowerCase() })).body).toEqual({ recovery: 'sealed-r' })
    const done = await call('POST', '/api/reset/complete', { email: 'a@x.io', code, loginKey: key('b'), keys: { password: 'sealed-p2' } })
    expect(done.status).toBe(200)
    expect((await call('GET', '/api/records', undefined, body.token)).status).toBe(401)
    expect((await call('GET', '/api/records', undefined, done.body.token)).body.records[0].sealed).toBe('sealed-data')
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('a') })).status).toBe(401)
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('b') })).body.keys).toEqual({ password: 'sealed-p2', recovery: 'sealed-r' })
    expect((await call('POST', '/api/reset/complete', { email: 'a@x.io', code, loginKey: key('c'), keys: { password: 'x' } })).status).toBe(400)
  })

  it('forgets a code after too many wrong tries', async () => {
    await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a'), keys: { password: 'sealed-p', recovery: 'sealed-r' } })
    await call('POST', '/api/reset/request', { email: 'a@x.io' })
    const code = /([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(mails[0].text)![1]
    for (let i = 0; i < 5; i += 1) await call('POST', '/api/reset/verify', { email: 'a@x.io', code: 'AAAA-AAAA' })
    expect((await call('POST', '/api/reset/verify', { email: 'a@x.io', code })).status).toBe(400)
  })

  it('starts fresh on request, leaving no old data or recovery key behind', async () => {
    const { body } = await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a'), keys: { password: 'sealed-p', recovery: 'sealed-r' } })
    await call('POST', '/api/records', { records: [{ kind: 'account', id: 'acc-1', sealed: 'sealed-data' }] }, body.token)
    await call('POST', '/api/reset/request', { email: 'a@x.io' })
    const code = /([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(mails[0].text)![1]
    const done = await call('POST', '/api/reset/complete', { email: 'a@x.io', code, loginKey: key('b'), keys: { password: 'new-p', recovery: 'new-r' }, fresh: true })
    expect((await call('GET', '/api/records', undefined, done.body.token)).body.records).toEqual([])
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('b') })).body.keys).toEqual({ password: 'new-p', recovery: 'new-r' })
  })
})
