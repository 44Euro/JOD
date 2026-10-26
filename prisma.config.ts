import { defineConfig } from 'prisma/config'

// Prisma no longer reads .env by itself; the file is optional so `prisma generate` works without a database.
try {
  process.loadEnvFile()
} catch {
  // No .env: commands that need the database will say so.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
