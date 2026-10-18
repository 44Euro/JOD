import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InstrumentFields, type InstrumentFieldsProps } from './InstrumentFields'

const blank: Omit<InstrumentFieldsProps, 'idPrefix' | 'symbolLabel'> = {
  market: 'CRYPTO',
  symbol: '',
  name: '',
  assetType: 'crypto',
  unit: 'coin',
  instruments: [],
  onMarket: vi.fn(),
  onSymbol: vi.fn(),
  onName: vi.fn(),
  onAssetType: vi.fn(),
  onUnit: vi.fn(),
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
    expect(screen.queryByLabelText('หน่วยนับ')).not.toBeInTheDocument()
  })

  it('asks for the unit after the asset type of a new symbol, under the id of its prefix', () => {
    render(<InstrumentFields idPrefix="tx-to" symbolLabel="สินทรัพย์ที่ได้รับ" {...blank} market="GOLD" assetType="gold" unit="baht_gold" />)
    const unit = screen.getByLabelText('หน่วยนับ')
    expect(unit).toHaveAttribute('id', 'tx-to-unit')
    expect(unit).toHaveDisplayValue('บาททองคำ')
    expect(Array.from((unit as HTMLSelectElement).options).map((o) => o.text)).toEqual(['หุ้น', 'หน่วย', 'เหรียญ', 'บาททองคำ', 'กรัม'])
    const fields = Array.from(document.querySelectorAll('select, input')).map((e) => e.id)
    expect(fields.indexOf('tx-to-unit')).toBe(fields.indexOf('tx-to-asset-type') + 1)
  })

  it('reports the unit that was picked', async () => {
    const onUnit = vi.fn()
    render(<InstrumentFields idPrefix="tx" symbolLabel="สัญลักษณ์" {...blank} market="GOLD" assetType="gold" unit="baht_gold" onUnit={onUnit} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('หน่วยนับ'), 'กรัม')
    expect(onUnit).toHaveBeenCalledWith('gram')
  })

  it('does not ask for the unit of a symbol that is already known', () => {
    const gold = { id: 'GOLD:96.5', market: 'GOLD', symbol: '96.5', name: 'ทอง 96.5%', assetType: 'gold', currency: 'THB' } as const
    render(<InstrumentFields idPrefix="tx" symbolLabel="สัญลักษณ์" {...blank} market="GOLD" symbol="96.5" instruments={[gold]} />)
    expect(screen.queryByLabelText('หน่วยนับ')).not.toBeInTheDocument()
  })

  it('suggests a symbol that fits the market', () => {
    const placeholder = (market: InstrumentFieldsProps['market']) => {
      const { unmount } = render(<InstrumentFields idPrefix="tx" symbolLabel="สัญลักษณ์" {...blank} market={market} />)
      const text = screen.getByLabelText('สัญลักษณ์').getAttribute('placeholder')
      unmount()
      return text
    }
    expect(placeholder('FUND')).toBe('SCBS&P500')
    expect(placeholder('BOND')).toBe('CPALL26NA')
    expect(placeholder('GOLD')).toBe('96.5')
    expect(placeholder('US')).toBe('AAPL, PTT, BTC')
    expect(placeholder('CRYPTO')).toBe('AAPL, PTT, BTC')
  })
})
