import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { FileStore } from './store.ts'

// Run with: node --experimental-strip-types server/main.ts   (PORT, DATA_DIR and ALLOW_ORIGIN can be set)
const port = Number(process.env.PORT ?? 8787)
const store = new FileStore(process.env.DATA_DIR ?? './sync-data')
createServer(createApp({ store, origin: process.env.ALLOW_ORIGIN ?? '*' })).listen(port, () => {
  console.log(`JOD sync server on http://localhost:${port}`)
})
