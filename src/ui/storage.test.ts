import { describe, expect, it, vi } from 'vitest'
import { ensurePersistentStorage } from './storage'

function fakeStorage(persisted: boolean, grants: boolean) {
  return {
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => grants),
  } as unknown as StorageManager & { persist: ReturnType<typeof vi.fn> }
}

describe('ensurePersistentStorage', () => {
  it('reports unsupported when the storage API is missing', async () => {
    expect(await ensurePersistentStorage({} as StorageManager)).toBe('unsupported')
  })

  it('does not ask again when storage is already persisted', async () => {
    const storage = fakeStorage(true, true)
    expect(await ensurePersistentStorage(storage)).toBe('persisted')
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('asks for persistence when it is not granted yet', async () => {
    const storage = fakeStorage(false, true)
    expect(await ensurePersistentStorage(storage)).toBe('persisted')
    expect(storage.persist).toHaveBeenCalledOnce()
  })

  it('reports not-persisted when the browser declines', async () => {
    expect(await ensurePersistentStorage(fakeStorage(false, false))).toBe('not-persisted')
  })
})
