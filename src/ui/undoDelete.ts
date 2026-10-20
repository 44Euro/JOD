import { useSyncExternalStore } from 'react'
import type { JodDB } from '../db/db'
import { deleteTransaction, restoreTransaction } from '../db/repo'
import type { Transaction } from '../domain/types'

export const UNDO_MS = 10_000

export interface PendingDelete {
  tx: Transaction
  deletedAt: number
}

interface Entry extends PendingDelete {
  timer: ReturnType<typeof setTimeout>
}

const entries = new Map<string, Entry>()
const restoring = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let snapshot: readonly PendingDelete[] = []

function publish(): void {
  snapshot = [...entries.values()].map(({ tx, deletedAt }) => ({ tx, deletedAt }))
  listeners.forEach((listener) => listener())
}

function forget(txId: string): void {
  const entry = entries.get(txId)
  if (!entry) return
  clearTimeout(entry.timer)
  entries.delete(txId)
  publish()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pendingDeletes(): readonly PendingDelete[] {
  return snapshot
}

export function usePendingDeletes(): readonly PendingDelete[] {
  return useSyncExternalStore(subscribe, pendingDeletes)
}

export async function deleteWithUndo(db: JodDB, tx: Transaction): Promise<void> {
  await deleteTransaction(db, tx.id)
  const previous = entries.get(tx.id)
  if (previous) clearTimeout(previous.timer)
  entries.set(tx.id, { tx, deletedAt: Date.now(), timer: setTimeout(() => forget(tx.id), UNDO_MS) })
  publish()
}

// A second press while the first restore is running joins it rather than adding the record twice.
export function undoDelete(db: JodDB, txId: string): Promise<void> {
  const running = restoring.get(txId)
  if (running) return running
  const entry = entries.get(txId)
  if (!entry) return Promise.resolve()
  const run = restoreTransaction(db, entry.tx)
    .then(() => forget(txId))
    .finally(() => restoring.delete(txId))
  restoring.set(txId, run)
  return run
}
