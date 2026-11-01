import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Instrument } from '../../domain/types'
import type { FoundAsset, MarketClient } from '../../market/client'
import { SearchSheet } from './SearchSheet'

const kbank: Instrument = { id: 'SET:KBANK', market: 'SET', symbol: 'KBANK', name: 'Kasikornbank', assetType: 'stock', currency: 'THB' }
const results: FoundAsset[] = [
  { market: 'SET', symbol: 'KBANK', name: 'Kasikornbank Public Company Limited', assetType: 'stock' },
  { market: 'SET', symbol: 'KBANK-R', name: 'Kasikornbank NVDR', assetType: 'stock' },
  { market: 'US', symbol: 'KO', name: 'Coca-Cola', assetType: 'stock' },
  { market: 'CRYPTO', symbol: 'KUB', name: 'Bitkub Coin', assetType: 'crypto' },
]

function client(search: MarketClient['search']): MarketClient {
  return { ready: () => true, search, quotes: async () => [], news: async () => [], earnings: async () => [], chart: () => Promise.reject(new Error('unused')), financials: () => Promise.reject(new Error('unused')), bigMoney: () => Promise.reject(new Error('unused')), bigMoneyFor: () => Promise.reject(new Error('unused')) }
}

function sheet(market: MarketClient, onPick = vi.fn(), onClose = vi.fn()) {
  render(<SearchSheet open onClose={onClose} onPick={onPick} instruments={[kbank]} market={market} />)
  return { onPick, onClose, input: screen.getByRole('combobox', { name: 'ค้นหาสินทรัพย์' }) }
}

const groupNames = () => screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))

beforeEach(() => localStorage.removeItem('jod-search-recent'))

describe('SearchSheet', () => {
  it('groups my own assets first, then US and Thai shares and coins', async () => {
    const user = userEvent.setup()
    const { input } = sheet(client(async () => results))
    expect(screen.getByRole('dialog', { name: 'ค้นหาสินทรัพย์' })).toBeInTheDocument()
    await user.type(input, 'k')
    await screen.findByRole('option', { name: /KO/ })
    expect(groupNames()).toEqual(['ของฉัน', 'หุ้น US', 'หุ้นไทย', 'คริปโต'])
    expect(screen.getAllByRole('option', { name: /^KBANK / })).toHaveLength(1)
    expect(within(screen.getByRole('group', { name: 'หุ้นไทย' })).getByRole('option')).toHaveTextContent('KBANK-R')
  })

  it('picks with the keyboard and remembers the pick', async () => {
    const user = userEvent.setup()
    const { input, onPick, onClose } = sheet(client(async () => results))
    await user.type(input, 'k')
    await screen.findByRole('option', { name: /KO/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith(results[2])
    expect(onClose).toHaveBeenCalled()

    cleanup()
    const again = sheet(client(async () => []))
    expect(screen.getByRole('group', { name: 'ค้นล่าสุด' })).toHaveTextContent('KO')
    expect(again.input).toHaveValue('')
  })

  it("keeps the newest query's results", async () => {
    const user = userEvent.setup()
    const asked: string[] = []
    let answerN: (found: FoundAsset[]) => void = () => {}
    const market = client((query) => {
      asked.push(query)
      if (query === 'n') return new Promise((resolve) => (answerN = resolve))
      return Promise.resolve([{ market: 'US', symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock' }])
    })
    const { input } = sheet(market)
    await user.type(input, 'n')
    await waitFor(() => expect(asked).toEqual(['n']))
    await user.type(input, 'v')
    await screen.findByRole('option', { name: /NVDA/ })
    answerN([{ market: 'US', symbol: 'NKE', name: 'Nike', assetType: 'stock' }])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('option', { name: /NKE/ })).not.toBeInTheDocument()
  })

  it('still lists my own matches when the server search fails', async () => {
    const user = userEvent.setup()
    const { input } = sheet(client(async () => Promise.reject(new Error('offline'))))
    await user.type(input, 'kb')
    expect(await screen.findByText('ค้นหาจากเซิร์ฟเวอร์ไม่ได้ตอนนี้')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /KBANK/ })).toBeInTheDocument()
  })

  it('gives the focus back to the button that opened it', async () => {
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>เปิดค้นหา</button>
          <SearchSheet open={open} onClose={() => setOpen(false)} onPick={() => {}} instruments={[]} market={client(async () => [])} />
        </>
      )
    }
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'เปิดค้นหา' }))
    expect(screen.getByRole('combobox', { name: 'ค้นหาสินทรัพย์' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'เปิดค้นหา' })).toHaveFocus()
  })

  it('closes on Escape and with the close button', async () => {
    const user = userEvent.setup()
    const { onClose } = sheet(client(async () => []))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
