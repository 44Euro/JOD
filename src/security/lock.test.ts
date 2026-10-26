import { beforeEach, describe, expect, it } from 'vitest'
import { LOCK_STORAGE_KEY, RELOCK_AFTER_MS, lockState, noteVisibility, removeLock, resetLockForTests, setPin, unlockWithPin } from './lock'

beforeEach(() => {
  localStorage.removeItem(LOCK_STORAGE_KEY)
  resetLockForTests()
})

describe('app lock', () => {
  it('is off until a PIN is set, and the PIN is never stored as typed', async () => {
    expect(lockState()).toBe('off')
    await expect(setPin('12a4')).rejects.toThrow('ตัวเลข 4–8 หลัก')
    await setPin('2468')
    expect(lockState()).toBe('open')
    expect(localStorage.getItem(LOCK_STORAGE_KEY)).not.toContain('2468')
  })

  it('locks on the next launch and opens with the right PIN only', async () => {
    await setPin('2468')
    resetLockForTests()
    expect(lockState()).toBe('locked')
    expect(await unlockWithPin('1111')).toBe(false)
    expect(await unlockWithPin('2468')).toBe(true)
    expect(lockState()).toBe('open')
  })

  it('locks again after five minutes in the background, not after a short switch', async () => {
    await setPin('2468')
    noteVisibility(false, 0)
    noteVisibility(true, 60_000)
    expect(lockState()).toBe('open')
    noteVisibility(false, 100_000)
    noteVisibility(true, 100_000 + RELOCK_AFTER_MS + 1)
    expect(lockState()).toBe('locked')
  })

  it('is removed only with the current PIN', async () => {
    await setPin('2468')
    await expect(removeLock('0000')).rejects.toThrow('PIN ไม่ถูก')
    await removeLock('2468')
    expect(lockState()).toBe('off')
  })
})
