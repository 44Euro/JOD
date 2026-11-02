import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { createMarket, type Market } from './market.ts'
import type { Push } from './push.ts'
import type { PushAlert } from './store.ts'
import { RECORD_KINDS, type IncomingRecord, type SealedKeys, type Store, type User } from './store.ts'

const scryptAsync = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>

const MAX_BODY = 25 * 1024 * 1024
const PAGE = 500
const SESSION_DAYS = 90
const LOGIN_LIMIT = 10
const RESET_MINUTES = 30
const RESET_ATTEMPTS = 5
const MAX_QUERY = 40
const MAX_IDS = 50
const MAX_NEWS_SYMBOLS = 10
const MAX_EARNINGS_DAYS = 14
const SYMBOL = /^[A-Z0-9.-]{1,12}$/
// No 0/O or 1/I/L, so a code read from an email is typed back without guessing.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export interface AppOptions {
  store: Store
  // Origins allowed to call the API from a browser; '*' allows any.
  origin?: string
  // Where the reset link in an email points.
  appUrl?: string
  sendMail?: (to: string, subject: string, text: string) => Promise<void>
  market?: Market
  // Price-alert pushes; absent until a Firebase service account is configured.
  push?: Push
}

// Until a mail service is set up the email goes to the server log, which is enough on a developer's machine.
async function logMail(to: string, subject: string, text: string) {
  console.log(`\n--- mail to ${to}: ${subject}\n${text}\n---`)
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
// each record sealed on the device with a key the server never gets.
export function createApp({ store, origin = '*', appUrl = 'http://localhost:5173', sendMail = logMail, market = createMarket(), push }: AppOptions) {
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
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
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

  function sealedKeys(value: unknown): SealedKeys {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object') throw new HttpError(400, 'bad keys')
    const keys: SealedKeys = {}
    for (const name of ['password', 'recovery'] as const) {
      const sealed = (value as Record<string, unknown>)[name]
      if (sealed === undefined) continue
      if (typeof sealed !== 'string' || sealed.length > 4096) throw new HttpError(400, 'bad keys')
      keys[name] = sealed
    }
    return keys
  }

  function incoming(value: unknown): IncomingRecord[] {
    if (!Array.isArray(value) || value.length > PAGE) throw new HttpError(400, 'bad records')
    return value.map((item) => {
      const record = item as Record<string, unknown>
      const kind = RECORD_KINDS.find((k) => k === record.kind)
      if (!kind || typeof record.id !== 'string' || record.id === '' || record.id.length > 200) throw new HttpError(400, 'bad records')
      if (record.sealed !== null && typeof record.sealed !== 'string') throw new HttpError(400, 'bad records')
      return { kind, id: record.id, sealed: record.sealed }
    })
  }

  function pushAlerts(value: unknown): PushAlert[] {
    if (!Array.isArray(value) || value.length > 100) throw new HttpError(400, 'bad alerts')
    return value.map((item) => {
      const a = item as Record<string, unknown>
      const ok =
        typeof a.id === 'string' &&
        typeof a.instrumentId === 'string' &&
        /^[A-Z]{2,6}:[A-Z0-9.&-]{1,20}$/.test(a.instrumentId) &&
        (a.direction === 'above' || a.direction === 'below') &&
        typeof a.price === 'string' &&
        /^\d+(\.\d+)?$/.test(a.price)
      if (!ok) throw new HttpError(400, 'bad alerts')
      return { id: a.id as string, instrumentId: a.instrumentId as string, direction: a.direction as PushAlert['direction'], price: a.price as string }
    })
  }

  async function hashed(loginKey: string) {
    const salt = randomBytes(16).toString('hex')
    return { salt, hash: (await scryptAsync(loginKey, salt, 32)).toString('hex') }
  }

  // A wrong code counts against the reset; after a few the code is gone and a new one has to be asked for.
  async function checkCode(body: Record<string, unknown>): Promise<User> {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : ''
    const reset = await store.getReset(email)
    const user = reset && (await store.findUser(email))
    if (!reset || !user) throw new HttpError(400, 'bad code')
    const given = Buffer.from(sha256(code))
    if (!timingSafeEqual(given, Buffer.from(reset.codeHash))) {
      await store.countWrongCode(email, RESET_ATTEMPTS)
      throw new HttpError(400, 'bad code')
    }
    return user
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
        const body = await readJson(req)
        const { email, loginKey } = credentials(body)
        const keys = sealedKeys(body.keys)
        if (await store.findUser(email)) throw new HttpError(409, 'email taken')
        const user = await store.addUser({ email, ...(await hashed(loginKey)), keys })
        return { status: 201, body: { token: await newSession(user.id) } }
      }
      case 'POST /api/login': {
        if (limited(ip)) throw new HttpError(429, 'slow down')
        const { email, loginKey } = credentials(await readJson(req))
        const user = await store.findUser(email)
        const hash = await scryptAsync(loginKey, user?.salt ?? 'no-user-salt', 32)
        if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) throw new HttpError(401, 'wrong email or password')
        return { status: 200, body: { token: await newSession(user.id), keys: user.keys } }
      }
      case 'PUT /api/keys': {
        const { userId } = await userOf(req)
        await store.setKeys(userId, sealedKeys((await readJson(req)).keys))
        return { status: 204, body: null }
      }
      case 'POST /api/reset/request': {
        if (limited(ip)) throw new HttpError(429, 'slow down')
        const email = String((await readJson(req)).email ?? '').trim().toLowerCase()
        // The answer is the same whether or not the email has an account, so the form cannot be used to find accounts.
        if (await store.findUser(email)) {
          const code = Array.from(randomBytes(8), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('')
          const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000)
          await store.putReset({ email, codeHash: sha256(code), expiresAt, attempts: 0 })
          const shown = `${code.slice(0, 4)}-${code.slice(4)}`
          const link = `${appUrl.replace(/\/+$/, '')}/#/reset?email=${encodeURIComponent(email)}&code=${shown}`
          await sendMail(
            email,
            'JOD: ตั้งรหัสผ่านใหม่',
            `รหัสสำหรับตั้งรหัสผ่านใหม่: ${shown}\nหรือเปิดลิงก์นี้: ${link}\nใช้ได้ ${RESET_MINUTES} นาที ถ้าไม่ได้ขอ ไม่ต้องทำอะไร`,
          )
        }
        return { status: 204, body: null }
      }
      case 'POST /api/reset/verify': {
        if (limited(ip)) throw new HttpError(429, 'slow down')
        const user = await checkCode(await readJson(req))
        return { status: 200, body: { recovery: user.keys.recovery ?? null } }
      }
      case 'POST /api/reset/complete': {
        if (limited(ip)) throw new HttpError(429, 'slow down')
        const body = await readJson(req)
        const user = await checkCode(body)
        const { loginKey } = credentials({ email: user.email, loginKey: body.loginKey })
        const keys = sealedKeys(body.keys)
        if (!keys.password) throw new HttpError(400, 'bad keys')
        // Starting fresh drops what the server holds: without the old key nobody can open it any more.
        const fresh = body.fresh === true
        if (fresh) await store.removeRecords(user.id)
        const { salt, hash } = await hashed(loginKey)
        await store.setPassword(user.id, salt, hash)
        await store.setKeys(user.id, fresh ? { password: keys.password, recovery: keys.recovery ?? null } : keys)
        await store.removeReset(user.email)
        await store.removeSessionsOf(user.id)
        return { status: 200, body: { token: await newSession(user.id) } }
      }
      case 'POST /api/logout': {
        const { tokenHash } = await userOf(req)
        await store.removeSession(tokenHash)
        return { status: 204, body: null }
      }
      case 'GET /api/records': {
        const { userId } = await userOf(req)
        const after = Number(url.searchParams.get('after') ?? 0)
        if (!Number.isInteger(after) || after < 0) throw new HttpError(400, 'bad after')
        const { change, records } = await store.records(userId, after, PAGE)
        return { status: 200, body: { change, records, more: records.length === PAGE } }
      }
      case 'POST /api/records': {
        const { userId } = await userOf(req)
        const records = incoming((await readJson(req)).records)
        return { status: 200, body: { change: await store.putRecords(userId, records) } }
      }
      // The session keeps the free quotas of the outside sources from being drained by anyone; who asked is not kept.
      case 'GET /api/market/search': {
        await userOf(req)
        const query = (url.searchParams.get('q') ?? '').trim()
        if (query === '' || query.length > MAX_QUERY) throw new HttpError(400, 'bad query')
        const results = await market.search(query).catch(() => {
          throw new HttpError(502, 'market source failed')
        })
        return { status: 200, body: { results } }
      }
      case 'GET /api/market/quotes': {
        await userOf(req)
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
        if (ids.length === 0 || ids.length > MAX_IDS) throw new HttpError(400, 'bad ids')
        return { status: 200, body: { quotes: await market.quotes(ids) } }
      }
      case 'GET /api/market/news': {
        await userOf(req)
        const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean)
        if (symbols.length > MAX_NEWS_SYMBOLS || !symbols.every((s) => SYMBOL.test(s))) throw new HttpError(400, 'bad symbols')
        if (!market.newsReady) throw new HttpError(503, 'news source not set')
        const news = await market.news(symbols).catch(() => {
          throw new HttpError(502, 'market source failed')
        })
        return { status: 200, body: { news } }
      }
      case 'GET /api/market/earnings': {
        await userOf(req)
        const from = url.searchParams.get('from') ?? ''
        const to = url.searchParams.get('to') ?? ''
        const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !(days >= 0 && days <= MAX_EARNINGS_DAYS)) {
          throw new HttpError(400, 'bad range')
        }
        if (!market.newsReady) throw new HttpError(503, 'news source not set')
        const earnings = await market.earnings(from, to).catch(() => {
          throw new HttpError(502, 'market source failed')
        })
        return { status: 200, body: { earnings } }
      }
      case 'GET /api/market/chart': {
        await userOf(req)
        const id = url.searchParams.get('id') ?? ''
        if (!/^[A-Z]{2,6}:[A-Z0-9.&-]{1,20}$/.test(id)) throw new HttpError(400, 'bad id')
        const chart = await market.chart(id).catch(() => {
          throw new HttpError(502, 'market source failed')
        })
        if (!chart) throw new HttpError(404, 'no chart')
        return { status: 200, body: { chart } }
      }
      case 'GET /api/market/financials': {
        await userOf(req)
        const symbol = url.searchParams.get('symbol') ?? ''
        if (!SYMBOL.test(symbol)) throw new HttpError(400, 'bad symbol')
        if (!market.financialsReady) throw new HttpError(503, 'filings source not set')
        const financials = await market.financials(symbol).catch(() => {
          throw new HttpError(502, 'market source failed')
        })
        if (!financials) throw new HttpError(404, 'no filings')
        return { status: 200, body: { financials } }
      }
      case 'GET /api/market/bigmoney': {
        await userOf(req)
        const symbol = url.searchParams.get('symbol')
        if (symbol !== null && !SYMBOL.test(symbol)) throw new HttpError(400, 'bad symbol')
        const bigMoney = await (symbol === null ? market.bigMoney() : market.bigMoneyFor(symbol)).catch(() => {
          throw new HttpError(502, 'market source failed')
        })
        return { status: 200, body: { bigMoney } }
      }
      // Only for a device whose person opted in; the opt-in screen says the server learns each alert's symbol and price.
      case 'POST /api/push/register': {
        const { userId } = await userOf(req)
        if (!push) throw new HttpError(503, 'push not set')
        const body = await readJson(req)
        const token = typeof body.token === 'string' ? body.token : ''
        if (!token || token.length > 4096 || (body.platform !== 'ios' && body.platform !== 'android')) throw new HttpError(400, 'bad device')
        await push.register(userId, { token, platform: body.platform, alerts: pushAlerts(body.alerts) })
        return { status: 204, body: null }
      }
      case 'DELETE /api/push/register': {
        const { userId } = await userOf(req)
        if (!push) throw new HttpError(503, 'push not set')
        const token = String((await readJson(req)).token ?? '')
        await push.unregister(userId, token)
        return { status: 204, body: null }
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
