// @vitest-environment node
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { FileStore } from './store.ts'

let server: Server
let base = ''
let dir = ''
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
  dir = await mkdtemp(join(tmpdir(), 'jod-sync-'))
  server = createServer(createApp({ store: new FileStore(dir) }))
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
    const index = await readFile(join(dir, 'index.json'), 'utf8')
    expect(index).not.toContain(key('a'))
    expect(index).not.toContain(ok.body.token)
  })

  it('keeps one sealed copy per user and refuses a write based on an old version', async () => {
    const { body } = await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a') })
    expect((await call('GET', '/api/sync', undefined, body.token)).body).toEqual({ version: 0, data: null, updatedAt: null })
    expect((await call('PUT', '/api/sync', { baseVersion: 0, data: 'sealed-1' }, body.token)).body.version).toBe(1)
    expect(await call('PUT', '/api/sync', { baseVersion: 0, data: 'sealed-x' }, body.token)).toEqual({ status: 409, body: { version: 1 } })
    expect((await call('PUT', '/api/sync', { baseVersion: 1, data: 'sealed-2' }, body.token)).body.version).toBe(2)
    expect((await call('GET', '/api/sync', undefined, body.token)).body).toMatchObject({ version: 2, data: 'sealed-2' })
  })

  it('needs a valid session, ends it on sign out, and deletes everything on request', async () => {
    expect((await call('GET', '/api/sync')).status).toBe(401)
    const { body } = await call('POST', '/api/signup', { email: 'a@x.io', loginKey: key('a') })
    await call('PUT', '/api/sync', { baseVersion: 0, data: 'sealed' }, body.token)
    expect((await call('DELETE', '/api/account', undefined, body.token)).status).toBe(204)
    expect((await call('GET', '/api/sync', undefined, body.token)).status).toBe(401)
    expect((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('a') })).status).toBe(401)
  })

  it('slows down repeated sign-in attempts', async () => {
    const statuses = []
    for (let i = 0; i < 12; i += 1) statuses.push((await call('POST', '/api/login', { email: 'a@x.io', loginKey: key('c') })).status)
    expect(statuses.slice(-1)).toEqual([429])
  })
})
