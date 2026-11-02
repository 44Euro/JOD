import { createSign } from 'node:crypto'
import type { Market } from './market.ts'
import type { PushAlert, Store } from './store.ts'

export type { PushAlert }

export type SendPush = (token: string, title: string, body: string) => Promise<void>

const DIRECTION = { above: 'สูงกว่า', below: 'ต่ำกว่า' }

// Price alerts the server watches for devices that opted in: each alert is sent once, then dropped from the device's
// list; one that could not be sent is kept and tried again on the next check.
export function createPush({ store, market, send }: { store: Store; market: Pick<Market, 'quotes'>; send: SendPush }) {
  return {
    register(userId: string, device: { token: string; platform: string; alerts: PushAlert[] }) {
      return store.putPushDevice({ ...device, userId })
    },
    unregister(userId: string, token: string) {
      return store.removePushDevice(userId, token)
    },
    async check(): Promise<number> {
      const devices = await store.pushDevices()
      const ids = [...new Set(devices.flatMap((d) => d.alerts.map((a) => a.instrumentId)))]
      if (ids.length === 0) return 0
      const prices = new Map((await market.quotes(ids)).map((q) => [q.id, q.price]))
      let count = 0
      for (const device of devices) {
        const sent = new Set<string>()
        for (const alert of device.alerts) {
          const price = prices.get(alert.instrumentId)
          if (price === undefined) continue
          const crossed = alert.direction === 'above' ? Number(price) >= Number(alert.price) : Number(price) <= Number(alert.price)
          if (!crossed) continue
          const symbol = alert.instrumentId.split(':')[1]
          const ok = await send(device.token, `JOD: ${symbol} ${DIRECTION[alert.direction]} ${alert.price}`, `ราคาล่าสุด ${price}`).then(
            () => true,
            () => false,
          )
          if (ok) sent.add(alert.id)
        }
        if (sent.size === 0) continue
        count += sent.size
        await store.putPushDevice({ ...device, alerts: device.alerts.filter((a) => !sent.has(a.id)) })
      }
      return count
    },
  }
}

export type Push = ReturnType<typeof createPush>

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

// Firebase Cloud Messaging (HTTP v1) with a service account: a signed JWT buys an hour-long access token, which is
// kept until a minute before it runs out. FCM delivers to iPhones too, through the APNs key uploaded to the project.
export function createFcmSender(serviceAccount: string, fetchFn: typeof fetch = (i, o) => fetch(i, o), now: () => number = Date.now): SendPush {
  const account = JSON.parse(serviceAccount) as { project_id: string; client_email: string; private_key: string; token_uri?: string }
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token'
  let access: { token: string; expires: number } | null = null

  async function accessToken(): Promise<string> {
    if (access && access.expires > now() + 60_000) return access.token
    const iat = Math.floor(now() / 1000)
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url')
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 })}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url')
    const res = await fetchFn(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    })
    if (!res.ok) throw new Error(`Google token answered ${res.status}`)
    const body = (await res.json()) as { access_token: string; expires_in: number }
    access = { token: body.access_token, expires: now() + body.expires_in * 1000 }
    return access.token
  }

  return async (deviceToken, title, body) => {
    const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: deviceToken, notification: { title, body } } }),
    })
    if (!res.ok) throw new Error(`FCM answered ${res.status}`)
  }
}
