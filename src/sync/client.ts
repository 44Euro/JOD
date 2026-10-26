import { t } from '../i18n'

export class SyncError extends Error {
  name = 'SyncError'
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface Remote {
  version: number
  data: string | null
}

export interface SealedKeys {
  password?: string
  recovery?: string
}

export interface SyncClient {
  signup(email: string, loginKey: string, keys?: SealedKeys): Promise<string>
  login(email: string, loginKey: string): Promise<{ token: string; keys: SealedKeys }>
  putKeys(token: string, keys: SealedKeys): Promise<void>
  requestReset(email: string): Promise<void>
  // Checks the emailed code and hands back the data key sealed with the recovery code, if the account has one.
  verifyReset(email: string, code: string): Promise<string | null>
  completeReset(reset: { email: string; code: string; loginKey: string; keys: SealedKeys; fresh?: boolean }): Promise<string>
  logout(token: string): Promise<void>
  pull(token: string): Promise<Remote>
  push(token: string, baseVersion: number, data: string): Promise<{ version: number } | { conflict: number }>
  deleteAccount(token: string): Promise<void>
}

function messageFor(status: number): string {
  if (status === 401) return t('อีเมลหรือรหัสผ่านไม่ถูก หรือต้องเข้าสู่ระบบใหม่')
  if (status === 409) return t('อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบแทน')
  if (status === 429) return t('ลองบ่อยเกินไป รอสักนาทีแล้วลองใหม่')
  if (status === 413) return t('ข้อมูลใหญ่เกินกว่าที่เซิร์ฟเวอร์รับได้')
  return t('เซิร์ฟเวอร์ซิงก์มีปัญหา ลองใหม่อีกครั้ง')
}

export function createSyncClient(server: string, fetchFn: typeof fetch = (i, o) => fetch(i, o)): SyncClient {
  const base = server.replace(/\/+$/, '')
  async function call(method: string, path: string, token?: string, body?: unknown, allow: number[] = []) {
    let res: Response
    try {
      res = await fetchFn(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new SyncError(0, t('ต่อเซิร์ฟเวอร์ซิงก์ไม่ได้ ตรวจที่อยู่และอินเทอร์เน็ต'))
    }
    if (!res.ok && !allow.includes(res.status)) throw new SyncError(res.status, messageFor(res.status))
    const text = await res.text()
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} }
  }
  return {
    async signup(email, loginKey, keys) {
      return (await call('POST', '/api/signup', undefined, { email, loginKey, keys })).body.token as string
    },
    async login(email, loginKey) {
      const { body } = await call('POST', '/api/login', undefined, { email, loginKey })
      return { token: body.token as string, keys: (body.keys as SealedKeys | undefined) ?? {} }
    },
    async putKeys(token, keys) {
      await call('PUT', '/api/keys', token, { keys })
    },
    async requestReset(email) {
      await call('POST', '/api/reset/request', undefined, { email })
    },
    async verifyReset(email, code) {
      const { status, body } = await call('POST', '/api/reset/verify', undefined, { email, code }, [400])
      if (status === 400) throw new SyncError(400, t('รหัสจากอีเมลไม่ถูกหรือหมดอายุ ขอรหัสใหม่ได้'))
      return (body.recovery as string | null) ?? null
    },
    async completeReset(reset) {
      const { status, body } = await call('POST', '/api/reset/complete', undefined, reset, [400])
      if (status === 400) throw new SyncError(400, t('รหัสจากอีเมลไม่ถูกหรือหมดอายุ ขอรหัสใหม่ได้'))
      return body.token as string
    },
    async logout(token) {
      await call('POST', '/api/logout', token).catch(() => {})
    },
    async pull(token) {
      const { body } = await call('GET', '/api/sync', token)
      return { version: body.version as number, data: (body.data as string | null) ?? null }
    },
    async push(token, baseVersion, data) {
      const { status, body } = await call('PUT', '/api/sync', token, { baseVersion, data }, [409])
      return status === 409 ? { conflict: body.version as number } : { version: body.version as number }
    },
    async deleteAccount(token) {
      await call('DELETE', '/api/account', token)
    },
  }
}
