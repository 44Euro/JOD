import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PrismaPGlite } from 'pglite-prisma-adapter'
import { PrismaClient } from './generated/prisma/client.ts'
import { Store } from './store.ts'

// Tests run from the project folder; a browser-like test environment has no file URL for this module to resolve from.
const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations')

// A real Postgres in memory, built from the same migrations the live database gets, for tests.
export async function createTestStore(): Promise<Store> {
  const pg = new PGlite()
  for (const name of readdirSync(MIGRATIONS).filter((n) => !n.endsWith('.toml')).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'))
  }
  return new Store(new PrismaClient({ adapter: new PrismaPGlite(pg) }))
}
