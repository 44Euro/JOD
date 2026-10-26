import { beforeEach, describe, expect, it } from 'vitest'
import { LOCK_STORAGE_KEY, RELOCK_AFTER_MS, lockState, noteVisibility, changePin, clearLock, resetLockForTests, setPin, unlockWithPin } from './lock'

beforeEach(() => {
  localStorage.removeItem(LOCK_STORAGE_KEY)
  resetLockForTests()
})

describe('app lock', () => {
  it('is off until a PIN is set, and the PIN is never stored as typed', async () => {
    expect(lockState()).toBe('off')
    await expect(setPin('2468')).rejects.toThrow('ตัวเลข 6 หลัก')
    await expect(setPin('12a456')).rejects.toThrow('ตัวเลข 6 หลัก')
    await setPin('246810')
    expect(lockState()).toBe('open')
    expect(localStorage.getItem(LOCK_STORAGE_KEY)).not.toContain('246810')
  })

  it('locks on the next launch and opens with the right PIN only', async () => {
    await setPin('246810')
    resetLockForTests()
    expect(lockState()).toBe('locked')
    expect(await unlockWithPin('111111')).toBe(false)
    expect(await unlockWithPin('246810')).toBe(true)
    expect(lockState()).toBe('open')
  })

  it('locks again after five minutes in the background, not after a short switch', async () => {
    await setPin('246810')
    noteVisibility(false, 0)
    noteVisibility(true, 60_000)
    expect(lockState()).toBe('open')
    noteVisibility(false, 100_000)
    noteVisibility(true, 100_000 + RELOCK_AFTER_MS + 1)
    expect(lockState()).toBe('locked')
  })

  it('changes only with the current PIN, and goes away on sign-out', async () => {
    await setPin('246810')
    await expect(changePin('000000', '135790')).rejects.toThrow('PIN ปัจจุบันไม่ถูก')
    await changePin('246810', '135790')
    resetLockForTests()
    expect(await unlockWithPin('135790')).toBe(true)
    clearLock()
    expect(lockState()).toBe('off')
  })
})
