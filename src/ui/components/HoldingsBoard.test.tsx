import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { D } from '../../domain/decimal'
import type { HoldingsBoardRow } from '../holdingsBoard'
import { assetPath } from '../nav'
import { HoldingsBoard } from './HoldingsBoard'

const nvda: HoldingsBoardRow = {
  instrumentId: 'US:NVDA',
  symbol: 'NVDA',
  market: 'US',
  unit: 'share',
  quantity: D(12),
  price: D('142.30'),
  priceDay: '2026-10-27',
  changePct: D('2.1'),
  comparedWithDay: '2026-10-26',
}

function show(rows: HoldingsBoardRow[]) {
  render(
    <MemoryRouter>
      <HoldingsBoard rows={rows} today="2026-10-27" />
    </MemoryRouter>,
  )
  return screen.getByRole('region', { name: 'ราคาที่ถืออยู่' })
}

describe('HoldingsBoard', () => {
  it('shows each holding with its units, price and signed change', () => {
    const row = within(show([nvda])).getByRole('link', { name: /NVDA/ })
    expect(row).toHaveTextContent('12')
    expect(row).toHaveTextContent('142.30')
    expect(row).toHaveTextContent('+2.10%')
  })

  it('says which day a price is from when it is not today', () => {
    expect(show([{ ...nvda, priceDay: '2026-10-20' }])).toHaveTextContent('ราคา 20 ต.ค. 2026')
  })

  it('shows a dash for a holding with no price yet', () => {
    const row = within(show([{ ...nvda, price: null, priceDay: null, changePct: null, comparedWithDay: null }])).getByRole('link', { name: /NVDA/ })
    expect(row).toHaveTextContent('—')
  })

  it('links each row to the asset page', () => {
    expect(within(show([nvda])).getByRole('link', { name: /NVDA/ })).toHaveAttribute('href', assetPath('US:NVDA'))
  })

  it('names what the change is measured against', () => {
    expect(show([nvda])).toHaveTextContent('เทียบราคาก่อนหน้า')
  })
})
