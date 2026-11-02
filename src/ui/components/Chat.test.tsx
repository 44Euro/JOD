import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_HISTORY_STORAGE_KEY, readLocal, writeApiKey, writeReaderMode } from '../../ai/apiKey'
import type { ChatMessage, ChatModel, ToolCall } from '../../ai/chat'
import { AiError } from '../../ai/reader'
import { db } from '../../db/db'
import { fakeFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

const baht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }

beforeEach(async () => {
  await resetDb()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 9, 0))
  await db.accounts.add({ id: 'acc-1', name: 'Streaming', broker: 'Streaming', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
  await db.instruments.bulkAdd([
    { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'PTT', assetType: 'stock', currency: 'THB', lastPrice: '30' },
    { id: 'SET:KBANK', market: 'SET', symbol: 'KBANK', name: 'KBANK', assetType: 'stock', currency: 'THB', lastPrice: '100' },
  ])
  await db.transactions.bulkAdd([
    makeTx({ ...baht, instrumentId: 'SET:PTT', quantity: '1000', price: '30' }),
    makeTx({ ...baht, instrumentId: 'SET:KBANK', quantity: '100', price: '100' }),
  ])
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

interface Seen {
  system: string
  history: ChatMessage[]
  given: string[]
}

// A model that plays back its rounds; a round of `wait` streams its text and then hangs until stopped.
function scripted(rounds: { text?: string; calls?: ToolCall[]; wait?: boolean; fail?: Error }[]) {
  const seen: Seen[] = []
  const model: ChatModel = (system, history) => {
    const asked: Seen = { system, history: [...history], given: [] }
    seen.push(asked)
    return {
      async next(onText, signal) {
        const step = rounds.shift() ?? { text: 'done' }
        if (step.fail) throw step.fail
        if (step.text) onText(step.text)
        if (step.wait) {
          return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))))
        }
        return step.calls ?? []
      },
      give(results) {
        asked.given.push(...results.map((r) => r.content))
      },
    }
  }
  return { model, seen }
}

function useClaude() {
  writeReaderMode('claude')
  writeApiKey('sk-ant-test')
}

const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })

async function openChat(chat: ChatModel) {
  renderRoute('/', fakeFxProvider({}).provider, undefined, chat)
  const u = user()
  await u.click(await screen.findByRole('button', { name: 'ถาม JOD' }))
  return { u, sheet: await screen.findByRole('dialog', { name: 'ถาม JOD · Claude (Anthropic)' }) }
}

describe('ถาม JOD', () => {
  it('has no orb while reading stays on the device or no key is set', async () => {
    renderRoute('/')
    await screen.findByRole('heading', { name: 'เช้านี้' })
    expect(screen.queryByRole('button', { name: 'ถาม JOD' })).not.toBeInTheDocument()
    writeReaderMode('claude')
    expect(screen.queryByRole('button', { name: 'ถาม JOD' })).not.toBeInTheDocument()
    writeApiKey('sk-ant-test')
    expect(await screen.findByRole('button', { name: 'ถาม JOD' })).toBeInTheDocument()
  })

  it('asks a suggestion from the portfolio and shows the streamed answer with the data it used', async () => {
    useClaude()
    const { model, seen } = scripted([{ calls: [{ id: 't1', name: 'portfolio_overview', input: {} }] }, { text: 'พอร์ตมีมูลค่า 40,000 บาท' }])
    const { u, sheet } = await openChat(model)
    expect(sheet).toHaveTextContent('ใช้ key ของคุณ')
    const suggestions = within(sheet).getByRole('group', { name: 'คำถามแนะนำ' })
    expect(within(suggestions).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'PTT ใหญ่ที่สุดในพอร์ต กระจุกตัวเกินไปไหม',
      'สรุปพอร์ตของฉันให้หน่อย',
      'ปันผล 12 เดือนข้างหน้าน่าจะได้เท่าไร',
    ])
    await u.click(within(suggestions).getByRole('button', { name: 'สรุปพอร์ตของฉันให้หน่อย' }))
    const answer = await within(sheet).findByText('พอร์ตมีมูลค่า 40,000 บาท')
    expect(answer.closest('li')).toHaveTextContent('ใช้ข้อมูล: พอร์ต')
    expect(seen[0].system).toContain('Today is 2026-11-01')
    expect(seen[0].history).toEqual([{ role: 'user', text: 'สรุปพอร์ตของฉันให้หน่อย' }])
    expect(JSON.parse(seen[0].given[0])).toMatchObject({ value: '40000', holdingsCount: 2 })
    expect(within(sheet).queryByRole('group', { name: 'คำถามแนะนำ' })).not.toBeInTheDocument()
  })

  it('keeps the conversation on this device across reopening until it is cleared', async () => {
    useClaude()
    const { model, seen } = scripted([{ text: 'สวัสดี' }, { text: 'PTT 30 บาท' }])
    const { u, sheet } = await openChat(model)
    await u.type(within(sheet).getByRole('textbox', { name: 'คำถาม' }), 'หวัดดี{Enter}')
    await within(sheet).findByText('สวัสดี')
    await u.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'ถาม JOD' })).toHaveFocus()

    await u.click(screen.getByRole('button', { name: 'ถาม JOD' }))
    const again = await screen.findByRole('dialog', { name: 'ถาม JOD · Claude (Anthropic)' })
    expect(within(again).getByText('หวัดดี')).toBeInTheDocument()
    await u.type(within(again).getByRole('textbox', { name: 'คำถาม' }), 'PTT เท่าไร{Enter}')
    await within(again).findByText('PTT 30 บาท')
    expect(seen[1].history.map((m) => m.text)).toEqual(['หวัดดี', 'สวัสดี', 'PTT เท่าไร'])
    expect(JSON.parse(readLocal(CHAT_HISTORY_STORAGE_KEY))).toHaveLength(4)

    await u.click(within(again).getByRole('button', { name: 'ล้างประวัติแชต' }))
    expect(within(again).queryByText('หวัดดี')).not.toBeInTheDocument()
    expect(within(again).getByRole('group', { name: 'คำถามแนะนำ' })).toBeInTheDocument()
    expect(readLocal(CHAT_HISTORY_STORAGE_KEY)).toBe('')
  })

  it('stops an answer and keeps what had arrived', async () => {
    useClaude()
    const { model } = scripted([{ text: 'ครึ่งคำตอบ', wait: true }])
    const { u, sheet } = await openChat(model)
    await u.type(within(sheet).getByRole('textbox', { name: 'คำถาม' }), 'ยาว ๆ{Enter}')
    await within(sheet).findByText('ครึ่งคำตอบ')
    await u.click(within(sheet).getByRole('button', { name: 'หยุด' }))
    expect(await within(sheet).findByRole('button', { name: 'ส่ง' })).toBeInTheDocument()
    expect(within(sheet).getByText('ครึ่งคำตอบ').closest('li')).toHaveTextContent('หยุดไว้')
  })

  it('puts the question back in the box when the answer fails', async () => {
    useClaude()
    const { model } = scripted([{ fail: new AiError('API key ไม่ถูกต้อง ตรวจอีกครั้งในหน้าตั้งค่า') }])
    const { u, sheet } = await openChat(model)
    await u.type(within(sheet).getByRole('textbox', { name: 'คำถาม' }), 'พอร์ตเป็นไง{Enter}')
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('API key ไม่ถูกต้อง')
    expect(within(sheet).getByRole('textbox', { name: 'คำถาม' })).toHaveValue('พอร์ตเป็นไง')
    expect(readLocal(CHAT_HISTORY_STORAGE_KEY)).toBe('')
  })

  it('sends an attached screenshot with the question', async () => {
    useClaude()
    vi.stubGlobal('createImageBitmap', async () => ({ width: 100, height: 80, close() {} }))
    const { model, seen } = scripted([{ text: 'เห็นรูปแล้ว' }])
    const { u, sheet } = await openChat(model)
    await u.upload(within(sheet).getByLabelText('แนบภาพหน้าจอ'), new File(['png'], 'port.png', { type: 'image/png' }))
    expect(await within(sheet).findByText('port.png')).toBeInTheDocument()
    await u.type(within(sheet).getByRole('textbox', { name: 'คำถาม' }), 'ดูรูปนี้{Enter}')
    await within(sheet).findByText('เห็นรูปแล้ว')
    expect(seen[0].history[0]).toMatchObject({ role: 'user', text: 'ดูรูปนี้', image: { kind: 'image', mediaType: 'image/png', data: 'cG5n' } })
    expect(within(sheet).getByText('ดูรูปนี้').closest('li')).toHaveTextContent('แนบรูป')
    expect(within(sheet).queryByText('port.png')).not.toBeInTheDocument()
  })
})
