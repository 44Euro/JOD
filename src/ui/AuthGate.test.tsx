import { mkdtemp } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.ts'
import { FileStore } from '../../server/store.ts'
import { db } from '../db/db'
import { LOCK_STORAGE_KEY, resetLockForTests } from '../security/lock'
import { installDirtyTracking } from '../sync/engine'
import { setAuthBypassForTests, setSyncServerForTests } from '../sync/session'
import { readSync, writeSync } from '../sync/state'
import { WELCOME_STORAGE_KEY } from './welcome'
import { renderRoute, resetDb } from '../test/render'

let server: Server

// As main.tsx does in the app, so local changes are known to need sending.
installDirtyTracking(db)

beforeEach(async () => {
  await resetDb()
  server = createServer(createApp({ store: new FileStore(await mkdtemp(join(tmpdir(), 'jod-auth-'))) }))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  setSyncServerForTests(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  writeSync(null)
  localStorage.removeItem(LOCK_STORAGE_KEY)
  localStorage.setItem(WELCOME_STORAGE_KEY, '1')
  resetLockForTests()
  setAuthBypassForTests(false)
})

afterEach(async () => {
  setAuthBypassForTests(true)
  writeSync(null)
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// Taps the digits on the on-screen pad, as a person on a phone would.
async function typePin(user: ReturnType<typeof userEvent.setup>, label: string, pin: string) {
  const pad = await screen.findByRole('group', { name: label })
  for (const digit of pin) await user.click(within(pad).getByRole('button', { name: digit }))
}

// Each sign-in derives keys the slow way, as it does for real, so these tests need longer than the default.
describe('AuthGate', { timeout: 30_000 }, () => {
  it('greets a first launch, then goes straight to sign-in after that', async () => {
    const user = userEvent.setup()
    localStorage.removeItem(WELCOME_STORAGE_KEY)
    renderRoute('/')
    expect(await screen.findByRole('heading', { name: 'จดทุกเทรด รู้ทุกบาท' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'สมัครบัญชี' }))
    expect(screen.getByRole('heading', { name: 'สร้างบัญชีใหม่' })).toBeInTheDocument()
    cleanup()
    renderRoute('/')
    expect(await screen.findByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeInTheDocument()
  })

  it('asks to sign in first, then for a 6-digit PIN, then opens the app', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    expect(await screen.findByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeInTheDocument()
    expect(screen.queryByText('http://localhost:8787')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'สมัครเลย' }))
    expect(screen.getByRole('heading', { name: 'สร้างบัญชีใหม่' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('อีเมล'), 'me@jod.test')
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'long password')
    await user.type(screen.getByLabelText('รหัสผ่านอีกครั้ง'), 'long password')
    await user.click(screen.getByRole('checkbox', { name: /ฉันยอมรับ/ }))
    await user.click(screen.getByRole('button', { name: 'สมัครและเข้าใช้งาน' }))
    expect(await screen.findByRole('heading', { name: 'ตั้ง PIN 6 หลัก' }, { timeout: 15_000 })).toBeInTheDocument()
    expect(readSync()?.email).toBe('me@jod.test')
    await typePin(user, 'PIN ใหม่', '123456')
    await typePin(user, 'PIN อีกครั้ง', '123456')
    expect(await screen.findByRole('heading', { name: 'ตั้งค่า' }, { timeout: 15_000 })).toBeInTheDocument()
    expect(screen.getByText('me@jod.test')).toBeInTheDocument()
  })

  it('opens with the PIN on the next launch and refuses a wrong one', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'สมัครเลย' }))
    await user.type(screen.getByLabelText('อีเมล'), 'me@jod.test')
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'long password')
    await user.type(screen.getByLabelText('รหัสผ่านอีกครั้ง'), 'long password')
    await user.click(screen.getByRole('checkbox', { name: /ฉันยอมรับ/ }))
    await user.click(screen.getByRole('button', { name: 'สมัครและเข้าใช้งาน' }))
    await typePin(user, 'PIN ใหม่', '123456')
    await typePin(user, 'PIN อีกครั้ง', '123456')
    await screen.findByRole('heading', { name: 'ตั้งค่า' }, { timeout: 15_000 })

    resetLockForTests()
    expect(await screen.findByRole('heading', { name: 'ใส่ PIN เพื่อเข้าแอป' })).toBeInTheDocument()
    await typePin(user, 'PIN', '000000')
    expect(await screen.findByText('PIN ไม่ถูก', {}, { timeout: 15_000 })).toBeInTheDocument()
    await user.keyboard('12345')
    expect(screen.getByRole('status', { name: 'PIN ใส่แล้ว 5 จาก 6 หลัก' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ลบตัวเลข' }))
    await user.click(screen.getByRole('button', { name: 'ลบตัวเลข' }))
    await user.click(screen.getByRole('button', { name: 'ลบตัวเลข' }))
    await user.click(screen.getByRole('button', { name: 'ลบตัวเลข' }))
    await user.click(screen.getByRole('button', { name: 'ลบตัวเลข' }))
    await typePin(user, 'PIN', '123456')
    expect(await screen.findByRole('heading', { name: 'ตั้งค่า' }, { timeout: 15_000 })).toBeInTheDocument()
  })

  it('signs out by sending the data first and then clearing the device', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'สมัครเลย' }))
    await user.type(screen.getByLabelText('อีเมล'), 'me@jod.test')
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'long password')
    await user.type(screen.getByLabelText('รหัสผ่านอีกครั้ง'), 'long password')
    await user.click(screen.getByRole('checkbox', { name: /ฉันยอมรับ/ }))
    await user.click(screen.getByRole('button', { name: 'สมัครและเข้าใช้งาน' }))
    await typePin(user, 'PIN ใหม่', '123456')
    await typePin(user, 'PIN อีกครั้ง', '123456')
    await screen.findByRole('heading', { name: 'ตั้งค่า' }, { timeout: 15_000 })
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })

    await user.click(screen.getByRole('button', { name: 'ออกจากระบบ' }))
    expect(await screen.findByRole('heading', { name: 'เข้าสู่ระบบ' }, { timeout: 15_000 })).toBeInTheDocument()
    expect(await db.accounts.count()).toBe(0)

    await user.type(screen.getByLabelText('อีเมล'), 'me@jod.test')
    await user.type(screen.getByLabelText('รหัสผ่าน'), 'long password')
    await user.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }))
    await screen.findByRole('heading', { name: 'ตั้ง PIN 6 หลัก' }, { timeout: 15_000 })
    await waitFor(async () => expect(await db.accounts.get('acc-1')).toBeDefined())
  })
})
