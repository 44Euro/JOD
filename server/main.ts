import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { FileStore } from './store.ts'

// Run with: node --experimental-strip-types server/main.ts   (PORT, DATA_DIR, ALLOW_ORIGIN and APP_URL can be set)
const port = Number(process.env.PORT ?? 8787)
const store = new FileStore(process.env.DATA_DIR ?? './sync-data')
createServer(createApp({ store, origin: process.env.ALLOW_ORIGIN ?? '*', appUrl: process.env.APP_URL })).listen(port, () => {
  console.log(`JOD sync server on http://localhost:${port}`)
})
