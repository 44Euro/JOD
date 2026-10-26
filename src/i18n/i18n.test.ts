/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { renderRoute, resetDb } from '../test/render'
import { EN } from './en'
import { setLanguageForTests, t } from './index'

afterEach(() => setLanguageForTests('th'))

describe('t', () => {
  it('returns the Thai as written and fills in the values', () => {
    expect(t('{0} วัน', 3)).toBe('3 วัน')
    expect(t('ภาพรวม')).toBe('ภาพรวม')
  })

  it('looks the Thai up in English, falling back to the Thai when missing', () => {
    setLanguageForTests('en')
    expect(t('{0} วัน', 3)).toBe('3 days')
    expect(t('ภาพรวม')).toBe('Overview')
    expect(t('ข้อความที่ไม่มีคำแปล')).toBe('ข้อความที่ไม่มีคำแปล')
  })

  it('has an English line for every placeholder it keeps', () => {
    for (const [th, en] of Object.entries(EN)) {
      expect((en.match(/\{\d+\}/g) ?? []).sort(), th).toEqual((th.match(/\{\d+\}/g) ?? []).sort())
    }
  })

  it('draws a page in English', async () => {
    await resetDb()
    await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
    setLanguageForTests('en')
    renderRoute('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Accounts and brokers' })).toBeInTheDocument()
  })
})

describe('the English dictionary', () => {
  it('has a line for every text the code passes to t()', () => {
    const root = join(process.cwd(), 'src')
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : [],
      )
    const missing = new Set<string>()
    for (const file of files(root)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
        const key = match[1].replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
        if (!(key in EN)) missing.add(key)
      }
    }
    expect([...missing]).toEqual([])
  })
})
