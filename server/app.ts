import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import type { FileStore } from './store.ts'

const scryptAsync = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>

const MAX_BODY = 25 * 1024 * 1024
const SESSION_DAYS = 90
const LOGIN_LIMIT = 10

export interface AppOptions {
  store: FileStore
  // Origins allowed to call the API from a browser; '*' allows any.
  origin?: string
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'too large')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'bad json')
  }
}

// The server never sees the password or the data: the app sends a key derived from the password for signing in, and
// the data sealed with another key derived on the device.
export function createApp({ store, origin = '*' }: AppOptions) {
  const attempts = new Map<string, { count: number; resetAt: number }>()

  function limited(ip: string) {
    const now = Date.now()
    const entry = attempts.get(ip)
    if (!entry || entry.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + 60_000 })
      return false
    }
    entry.count += 1
    return entry.count > LOGIN_LIMIT
  }

  async function newSession(userId: string) {
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()
    await store.addSession({ tokenHash: sha256(token), userId, expiresAt })
    return token
  }

  async function userOf(req: IncomingMessage) {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const userId = token ? await store.sessionUser(sha256(token)) : null
    if (!userId) throw new HttpError(401, 'sign in')
    return { userId, tokenHash: sha256(token) }
  }

  function credentials(body: Record<string, unknown>) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const loginKey = typeof body.loginKey === 'string' ? body.loginKey : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9a-f]{64}$/.test(loginKey)) throw new HttpError(400, 'bad credentials')
    return { email, loginKey }
  }

  async function route(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const url = new URL(req.url ?? '/', 'http://local')
    const key = `${req.method} ${url.pathname}`
    const ip = req.socket.remoteAddress ?? ''
    switch (key) {
      case 'GET /api/health':
        return { status: 200, body: { ok: true } }
      case 'POST /api/signup': {
        if (limited(ip)) throw new HttpError(429, 'slow down')
        const { email, loginKey } = credentials(await readJson(req))
        if (await store.findUser(email)) throw new HttpError(409, 'email taken')
        const salt = randomBytes(16).toString('hex')
        const hash = (await scryptAsync(loginKey, salt, 32)).toString('hex')
        const user = { id: randomUUID(), email, salt, hash, createdAt: new Date().toISOString() }
        await store.addUser(user)
        return { status: 201, body: { token: await newSession(user.id) } }
      }
      case 'POST /api/login': {
        if (limited(ip)) throw new HttpError(429, 'slow down')
        const { email, loginKey } = credentials(await readJson(req))
        const user = await store.findUser(email)
        const hash = await scryptAsync(loginKey, user?.salt ?? 'no-user-salt', 32)
        if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) throw new HttpError(401, 'wrong email or password')
        return { status: 200, body: { token: await newSession(user.id) } }
      }
      case 'POST /api/logout': {
        const { tokenHash } = await userOf(req)
        await store.removeSession(tokenHash)
        return { status: 204, body: null }
      }
      case 'GET /api/sync': {
        const { userId } = await userOf(req)
        return { status: 200, body: (await store.getBlob(userId)) ?? { version: 0, data: null, updatedAt: null } }
      }
      case 'PUT /api/sync': {
        const { userId } = await userOf(req)
        const body = await readJson(req)
        if (!Number.isInteger(body.baseVersion) || typeof body.data !== 'string') throw new HttpError(400, 'bad sync body')
        const saved = await store.putBlob(userId, body.baseVersion as number, body.data)
        if (!saved) return { status: 409, body: { version: (await store.getBlob(userId))?.version ?? 0 } }
        return { status: 200, body: { version: saved.version, updatedAt: saved.updatedAt } }
      }
      case 'DELETE /api/account': {
        const { userId } = await userOf(req)
        await store.removeUser(userId)
        return { status: 204, body: null }
      }
      default:
        throw new HttpError(404, 'not found')
    }
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    try {
      const { status, body } = await route(req)
      res.writeHead(status, { 'content-type': 'application/json' }).end(body === null ? undefined : JSON.stringify(body))
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (status === 500) console.error(error)
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof HttpError ? error.message : 'server error' }))
    }
  }
}
