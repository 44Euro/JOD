import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { loadSampleData } from '../db/sampleData'
import { fakeFxProvider } from '../test/fakeFx'
import { renderRoute, resetDb } from '../test/render'

const PAGES: [string, string][] = [
  ['/', 'ภาพรวม'],
  ['/portfolio', 'พอร์ต'],
  ['/transactions', 'รายการทั้งหมด'],
  ['/trades', 'เทรด'],
  ['/fx', 'ค่าเงิน'],
  ['/income', 'รายได้'],
  ['/settings', 'ตั้งค่า'],
]

const phone = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0))
  await resetDb()
  await loadSampleData(db, '2026-10-19')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('every control has a name', () => {
  for (const layout of ['desktop', 'phone'] as const) {
    it.each(PAGES)(`names every button and link on %s (${layout})`, async (path, heading) => {
      if (layout === 'phone') phone()
      renderRoute(path, fakeFxProvider({ 'USD|THB': '33.5' }).provider)
      await screen.findByRole('heading', { level: 1, name: heading })
      expect(screen.queryAllByRole('button', { name: '' })).toEqual([])
      expect(screen.queryAllByRole('link', { name: '' })).toEqual([])
    })
  }
})
