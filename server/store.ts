import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface User {
  id: string
  email: string
  salt: string
  hash: string
  createdAt: string
}

export interface Session {
  tokenHash: string
  userId: string
  expiresAt: string
}

export interface Blob {
  version: number
  data: string
  updatedAt: string
}

interface Index {
  users: User[]
  sessions: Session[]
}

// Plain JSON files: one index of users and sessions, one file per user's sealed data. Enough for a self-hosted server
// with a handful of people; every write goes through a temporary file so a crash never leaves half a file.
export class FileStore {
  private dir: string
  private index: Index | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(dir: string) {
    this.dir = dir
  }

  private async load(): Promise<Index> {
    if (this.index) return this.index
    await mkdir(join(this.dir, 'data'), { recursive: true })
    try {
      this.index = JSON.parse(await readFile(join(this.dir, 'index.json'), 'utf8')) as Index
    } catch {
      this.index = { users: [], sessions: [] }
    }
    return this.index
  }

  private async write(file: string, content: string) {
    const tmp = `${file}.tmp`
    await writeFile(tmp, content)
    await rename(tmp, file)
  }

  // Writes run one after another, so two requests never interleave their read and write of the index.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  private saveIndex() {
    return this.write(join(this.dir, 'index.json'), JSON.stringify(this.index))
  }

  findUser(email: string): Promise<User | undefined> {
    return this.load().then((i) => i.users.find((u) => u.email === email))
  }

  addUser(user: User): Promise<void> {
    return this.serial(async () => {
      const i = await this.load()
      if (i.users.some((u) => u.email === user.email)) throw new Error('exists')
      i.users.push(user)
      await this.saveIndex()
    })
  }

  addSession(session: Session): Promise<void> {
    return this.serial(async () => {
      const i = await this.load()
      const now = new Date().toISOString()
      i.sessions = [...i.sessions.filter((s) => s.expiresAt > now), session]
      await this.saveIndex()
    })
  }

  async sessionUser(tokenHash: string): Promise<string | null> {
    const i = await this.load()
    const s = i.sessions.find((x) => x.tokenHash === tokenHash && x.expiresAt > new Date().toISOString())
    return s?.userId ?? null
  }

  removeSession(tokenHash: string): Promise<void> {
    return this.serial(async () => {
      const i = await this.load()
      i.sessions = i.sessions.filter((s) => s.tokenHash !== tokenHash)
      await this.saveIndex()
    })
  }

  private blobFile(userId: string) {
    return join(this.dir, 'data', `${userId}.json`)
  }

  async getBlob(userId: string): Promise<Blob | null> {
    await this.load()
    try {
      return JSON.parse(await readFile(this.blobFile(userId), 'utf8')) as Blob
    } catch {
      return null
    }
  }

  // Saves only when the caller saw the latest version; returns the stored version, or null on a conflict.
  putBlob(userId: string, baseVersion: number, data: string): Promise<Blob | null> {
    return this.serial(async () => {
      const current = await this.getBlob(userId)
      if ((current?.version ?? 0) !== baseVersion) return null
      const blob = { version: baseVersion + 1, data, updatedAt: new Date().toISOString() }
      await this.write(this.blobFile(userId), JSON.stringify(blob))
      return blob
    })
  }

  removeUser(userId: string): Promise<void> {
    return this.serial(async () => {
      const i = await this.load()
      i.users = i.users.filter((u) => u.id !== userId)
      i.sessions = i.sessions.filter((s) => s.userId !== userId)
      await this.saveIndex()
      await rm(this.blobFile(userId), { force: true })
    })
  }
}
