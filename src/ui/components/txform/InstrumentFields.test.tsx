import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InstrumentFields, type InstrumentFieldsProps } from './InstrumentFields'

const blank: Omit<InstrumentFieldsProps, 'idPrefix' | 'symbolLabel'> = {
  market: 'CRYPTO',
  symbol: '',
  name: '',
  assetType: 'crypto',
  instruments: [],
  onMarket: vi.fn(),
  onSymbol: vi.fn(),
  onName: vi.fn(),
  onAssetType: vi.fn(),
}

describe('InstrumentFields', () => {
  it('names every control from its prefix so two sets can live in one form', () => {
    render(
      <>
        <InstrumentFields idPrefix="tx" symbolLabel="สินทรัพย์ที่แลกออก" {...blank} />
        <InstrumentFields idPrefix="tx-to" symbolLabel="สินทรัพย์ที่ได้รับ" {...blank} />
      </>,
    )
    expect(screen.getByLabelText('สินทรัพย์ที่แลกออก')).toHaveAttribute('id', 'tx-symbol')
    expect(screen.getByLabelText('สินทรัพย์ที่ได้รับ')).toHaveAttribute('id', 'tx-to-symbol')
    expect(document.querySelectorAll('#tx-market, #tx-to-market')).toHaveLength(2)
  })

  it('hides the name and type of a new symbol when new ones are not allowed', () => {
    render(<InstrumentFields idPrefix="tx-fee" symbolLabel="สินทรัพย์ที่ใช้จ่าย" {...blank} symbol="BNB" allowNew={false} />)
    expect(screen.queryByLabelText('ชื่อ (ไม่บังคับ)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ประเภทสินทรัพย์')).not.toBeInTheDocument()
  })
})
