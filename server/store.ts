import type { PrismaClient } from './generated/prisma/client.ts'
import type { RecordKind } from './generated/prisma/enums.ts'

export const RECORD_KINDS = ['account', 'instrument', 'transaction', 'setting', 'daily_value', 'import', 'plan', 'watch', 'picture'] as const

export interface SealedKeys {
  password?: string
  recovery?: string
}

export interface User {
  id: string
  email: string
  salt: string
  hash: string
  keys: SealedKeys
}

export interface Reset {
  email: string
  codeHash: string
  expiresAt: Date
  attempts: number
}

export interface StoredRecord {
  kind: RecordKind
  id: string
  // Null for a deleted record.
  sealed: string | null
  change: number
}

export interface IncomingRecord {
  kind: RecordKind
  id: string
  sealed: string | null
}

type UserRow = { id: string; email: string; salt: string; hash: string; sealedPasswordKey: string | null; sealedRecoveryKey: string | null }

function toUser(row: UserRow | null): User | undefined {
  if (!row) return undefined
  const keys: SealedKeys = {}
  if (row.sealedPasswordKey) keys.password = row.sealedPasswordKey
  if (row.sealedRecoveryKey) keys.recovery = row.sealedRecoveryKey
  return { id: row.id, email: row.email, salt: row.salt, hash: row.hash, keys }
}

function keyColumns(keys: SealedKeys) {
  return {
    ...(keys.password !== undefined ? { sealedPasswordKey: keys.password } : {}),
    ...(keys.recovery !== undefined ? { sealedRecoveryKey: keys.recovery } : {}),
  }
}

// Everything the sync server keeps, in Postgres through Prisma.
export class Store {
  private db: PrismaClient

  constructor(db: PrismaClient) {
    this.db = db
  }

  async findUser(email: string): Promise<User | undefined> {
    return toUser(await this.db.user.findUnique({ where: { email } }))
  }

  async findUserById(id: string): Promise<User | undefined> {
    return toUser(await this.db.user.findUnique({ where: { id } }))
  }

  async addUser(user: { email: string; salt: string; hash: string; keys: SealedKeys }): Promise<User> {
    return toUser(await this.db.user.create({ data: { email: user.email, salt: user.salt, hash: user.hash, ...keyColumns(user.keys) } }))!
  }

  async setPassword(userId: string, salt: string, hash: string): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { salt, hash } })
  }

  // Keys left out stay as they are; null clears one.
  async setKeys(userId: string, keys: { password?: string | null; recovery?: string | null }): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: {
        ...(keys.password !== undefined ? { sealedPasswordKey: keys.password } : {}),
        ...(keys.recovery !== undefined ? { sealedRecoveryKey: keys.recovery } : {}),
      },
    })
  }

  async addSession(session: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void> {
    await this.db.$transaction([this.db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }), this.db.session.create({ data: session })])
  }

  async sessionUser(tokenHash: string): Promise<string | null> {
    const session = await this.db.session.findUnique({ where: { tokenHash } })
    return session && session.expiresAt > new Date() ? session.userId : null
  }

  async removeSession(tokenHash: string): Promise<void> {
    await this.db.session.deleteMany({ where: { tokenHash } })
  }

  async removeSessionsOf(userId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { userId } })
  }

  // One open reset per email: asking again replaces the earlier code.
  async putReset(reset: Reset): Promise<void> {
    await this.db.passwordReset.upsert({ where: { email: reset.email }, create: reset, update: reset })
  }

  async getReset(email: string): Promise<Reset | undefined> {
    const reset = await this.db.passwordReset.findUnique({ where: { email } })
    return reset && reset.expiresAt > new Date() ? reset : undefined
  }

  async countWrongCode(email: string, limit: number): Promise<void> {
    const reset = await this.db.passwordReset.update({ where: { email }, data: { attempts: { increment: 1 } } })
    if (reset.attempts >= limit) await this.removeReset(email)
  }

  async removeReset(email: string): Promise<void> {
    await this.db.passwordReset.deleteMany({ where: { email } })
  }

  async removeUser(userId: string): Promise<void> {
    await this.db.user.delete({ where: { id: userId } })
  }

  async records(userId: string, after: number, limit: number): Promise<{ change: number; records: StoredRecord[] }> {
    const [user, rows] = await this.db.$transaction([
      this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { changeCount: true } }),
      this.db.syncRecord.findMany({ where: { userId, change: { gt: after } }, orderBy: { change: 'asc' }, take: limit }),
    ])
    return { change: user.changeCount, records: rows.map((r) => ({ kind: r.kind, id: r.recordId, sealed: r.sealed, change: r.change })) }
  }

  // Each record written gets the next number of the person's count, so a device that has seen up to a number has
  // seen everything before it. The last write of a record wins.
  async putRecords(userId: string, records: IncomingRecord[]): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const { changeCount } = await tx.user.update({ where: { id: userId }, data: { changeCount: { increment: records.length } } })
      let change = changeCount - records.length
      for (const record of records) {
        change += 1
        const key = { userId_kind_recordId: { userId, kind: record.kind, recordId: record.id } }
        await tx.syncRecord.upsert({
          where: key,
          create: { userId, kind: record.kind, recordId: record.id, sealed: record.sealed, change },
          update: { sealed: record.sealed, change },
        })
      }
      return changeCount
    })
  }

  // A reset that starts fresh leaves nothing behind that the old key sealed. The count carries on, so a device that
  // still remembers an old number cannot mistake new records for ones it has seen.
  async removeRecords(userId: string): Promise<void> {
    await this.db.syncRecord.deleteMany({ where: { userId } })
  }
}
