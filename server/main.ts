import { createServer } from 'node:http'
import { PrismaPg } from '@prisma/adapter-pg'
import { createApp } from './app.ts'
import { createMarket } from './market.ts'
import { PrismaClient } from './generated/prisma/client.ts'
import { Store } from './store.ts'

// Run with: npm run sync-server   (DATABASE_URL from .env; PORT, ALLOW_ORIGIN, APP_URL, FINNHUB_API_KEY and SEC_USER_AGENT can be set)
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set: put the Postgres connection string in .env')
const port = Number(process.env.PORT ?? 8787)
const store = new Store(new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }))
const market = createMarket({ finnhubKey: process.env.FINNHUB_API_KEY, secUserAgent: process.env.SEC_USER_AGENT })
// House reports and 13F tables are slow to read, so they are read when the server starts and once a day after.
const warmUp = () => void market.warmUp().catch((error: unknown) => console.error('market warm-up failed', error))
warmUp()
setInterval(warmUp, 24 * 3_600_000).unref()
createServer(createApp({ store, origin: process.env.ALLOW_ORIGIN ?? '*', appUrl: process.env.APP_URL, market })).listen(port, () => {
  console.log(`JOD sync server on http://localhost:${port}`)
})
