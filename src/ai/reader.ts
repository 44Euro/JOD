import { createContext, useContext } from 'react'
import { ExtractionError, type Extraction } from './extraction'
import type { PreparedFile } from './files'
import { createLocalReader } from './localReader'
import { t } from '../i18n'

export const AI_MODEL = 'claude-opus-5-5'

// The app reads files only through this, so another reader (a server-side one before others use the app, or one for
// the mobile app) can stand in without touching the pages.
export interface AiReader {
  read(files: readonly PreparedFile[], today: string, signal?: AbortSignal): Promise<Extraction>
  test(signal?: AbortSignal): Promise<void>
}

export const READER_MODES = ['local', 'claude'] as const
export type ReaderMode = (typeof READER_MODES)[number]

export class AiError extends Error {
  name = 'AiError'
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function describeAiError(error: unknown): string {
  if (error instanceof AiError || error instanceof ExtractionError) return error.message
  return t('อ่านไม่สำเร็จ ลองใหม่อีกครั้ง หรือกรอกรายการเอง')
}

// The SDK is about a third of the app's size, so it loads only when someone reads with Claude.
function lazyClaudeReader(apiKey: string): AiReader {
  const load = () => import('./claudeReader').then(({ createClaudeReader }) => createClaudeReader(apiKey))
  return {
    read: async (files, today, signal) => (await load()).read(files, today, signal),
    test: async (signal) => (await load()).test(signal),
  }
}

export function createReader(mode: ReaderMode, apiKey: string): AiReader {
  return mode === 'claude' ? lazyClaudeReader(apiKey) : createLocalReader()
}

export const AiReaderContext = createContext<(mode: ReaderMode, apiKey: string) => AiReader>(createReader)

export function useReaderFactory(): (mode: ReaderMode, apiKey: string) => AiReader {
  return useContext(AiReaderContext)
}
