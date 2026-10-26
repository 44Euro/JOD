import { createServer } from 'node:http'
import { PrismaPg } from '@prisma/adapter-pg'
import { createApp } from './app.ts'
import { PrismaClient } from './generated/prisma/client.ts'
import { Store } from './store.ts'

// Run with: npm run sync-server   (DATABASE_URL from .env; PORT, ALLOW_ORIGIN and APP_URL can be set)
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set: put the Postgres connection string in .env')
const port = Number(process.env.PORT ?? 8787)
const store = new Store(new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }))
createServer(createApp({ store, origin: process.env.ALLOW_ORIGIN ?? '*', appUrl: process.env.APP_URL })).listen(port, () => {
  console.log(`JOD sync server on http://localhost:${port}`)
})
