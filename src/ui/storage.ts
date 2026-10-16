export type StorageStatus = 'persisted' | 'not-persisted' | 'unsupported'

// Without persistence the browser may evict IndexedDB under storage pressure, taking every record with it.
export async function ensurePersistentStorage(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): Promise<StorageStatus> {
  if (!storage?.persist || !storage.persisted) return 'unsupported'
  if (await storage.persisted()) return 'persisted'
  return (await storage.persist()) ? 'persisted' : 'not-persisted'
}
