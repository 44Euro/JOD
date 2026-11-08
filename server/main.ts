import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { PrismaPg } from '@prisma/adapter-pg'
import { createApp } from './app.ts'
import { createResendMail } from './mail.ts'
import { createMarket } from './market.ts'
import { createFcmSender, createPush, serviceAccountJson } from './push.ts'
import { PrismaClient } from './generated/prisma/client.ts'
import { Store } from './store.ts'

// Run with: npm run sync-server   (DATABASE_URL from .env; PORT, ALLOW_ORIGIN, APP_URL, TRUST_PROXY, DATABASE_CA, RESEND_API_KEY,
// MAIL_FROM, FINNHUB_API_KEY, SEC_USER_AGENT and FIREBASE_SERVICE_ACCOUNT can be set)
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set: put the Postgres connection string in .env')
const port = Number(process.env.PORT ?? 8787)
const origin = process.env.ALLOW_ORIGIN ?? '*'
// A live server that forgot its origins would answer any website, so it refuses to start instead.
if (process.env.NODE_ENV === 'production') {
  if (origin.split(',').some((o) => o.trim() === '*')) throw new Error('ALLOW_ORIGIN must list the app origins in production')
  if (!process.env.APP_URL) throw new Error('APP_URL must be set in production: reset emails link to it')
}
// The connection to a hosted database is always encrypted; with the provider's CA file (DATABASE_CA) the server is also verified.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
const ca = process.env.DATABASE_CA ? readFileSync(process.env.DATABASE_CA, 'utf8') : undefined
const ssl = local ? undefined : ca ? { ca } : { rejectUnauthorized: false }
const store = new Store(new PrismaClient({ adapter: new PrismaPg({ connectionString: url, ssl }) }))
const market = createMarket({ finnhubKey: process.env.FINNHUB_API_KEY, secUserAgent: process.env.SEC_USER_AGENT })
// House reports and 13F tables are slow to read, so they are read when the server starts and once a day after.
const warmUp = () => void market.warmUp().catch((error: unknown) => console.error('market warm-up failed', error))
warmUp()
setInterval(warmUp, 24 * 3_600_000).unref()
// Price-alert pushes stay off until a Firebase service account (its JSON or the path of its key file) is set; the push_devices table comes from
// `npm run db:migrate`.
const firebase = process.env.FIREBASE_SERVICE_ACCOUNT
const push = firebase ? createPush({ store, market, send: createFcmSender(serviceAccountJson(firebase)) }) : undefined
if (push) setInterval(() => void push.check().catch((error: unknown) => console.error('push check failed', error)), 15 * 60_000).unref()
const trustProxy = process.env.TRUST_PROXY === '1'
// Without a mail service reset codes only reach the server log, which works for a developer and for nobody else.
const sendMail = process.env.RESEND_API_KEY && process.env.MAIL_FROM ? createResendMail(process.env.RESEND_API_KEY, process.env.MAIL_FROM) : undefined
if (!sendMail && process.env.NODE_ENV === 'production') console.error('RESEND_API_KEY and MAIL_FROM are not set: password-reset emails will not be sent')
createServer(createApp({ store, origin, trustProxy, log: (line) => console.log(line), appUrl: process.env.APP_URL, sendMail, market, push })).listen(port, () => {
  console.log(`JOD sync server on http://localhost:${port}`)
})
