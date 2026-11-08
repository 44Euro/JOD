// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createResendMail } from './mail.ts'

describe('createResendMail', () => {
  it('sends the reset email through Resend with the key and sender the operator set', async () => {
    const sent: { url: string; init: RequestInit }[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent.push({ url, init })
      return new Response('{"id":"m1"}', { status: 200 })
    }) as typeof fetch
    await createResendMail('re_key', 'JOD <no-reply@jod.app>', fetchFn)('a@x.io', 'JOD: ตั้งรหัสผ่านใหม่', 'รหัส ABCD-EFGH')
    expect(sent[0].url).toBe('https://api.resend.com/emails')
    expect((sent[0].init.headers as Record<string, string>).authorization).toBe('Bearer re_key')
    expect(JSON.parse(sent[0].init.body as string)).toEqual({ from: 'JOD <no-reply@jod.app>', to: ['a@x.io'], subject: 'JOD: ตั้งรหัสผ่านใหม่', text: 'รหัส ABCD-EFGH' })
  })

  it('fails loudly when Resend refuses, so the server log shows it', async () => {
    const fetchFn = (async () => new Response('{"message":"bad key"}', { status: 401 })) as unknown as typeof fetch
    await expect(createResendMail('re_bad', 'JOD <no-reply@jod.app>', fetchFn)('a@x.io', 's', 't')).rejects.toThrow('mail failed: 401')
  })
})
