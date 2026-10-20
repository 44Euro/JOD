import { afterEach, describe, expect, it } from 'vitest'
import type { Transaction } from '../domain/types'
import { makeTx } from '../test/fixtures'
import { previewAfterSave } from './afterSave'
import { setNumbersHidden } from './format'

afterEach(() => setNumbersHidden(false))

describe('previewAfterSave', () => {
  it('hides the quantity held but keeps the average cost and the average rate while the numbers are hidden', () => {
    const others = [makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' })]
    const tx = makeTx({ quantity: '10', price: '120', fxRate: '33', date: '2024-02-10' })
    setNumbersHidden(true)
    expect(previewAfterSave(others, tx, 'THB', 'AAPL').rows).toEqual([
      { label: 'AAPL ที่ถือ', before: '•••', after: '•••' },
      { label: 'ทุนเฉลี่ย (USD)', before: '100', after: '110' },
      { label: 'เรทเฉลี่ยตอนซื้อ', before: '35', after: '33.9091', fx: true },
    ])
  })

  it('shows how the holding, its average cost and its average rate change', () => {
    const others = [makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' })]
    const tx = makeTx({ quantity: '10', price: '120', fxRate: '33', date: '2024-02-10' })
    const { rows, warning } = previewAfterSave(others, tx, 'THB', 'AAPL')
    expect(rows).toEqual([
      { label: 'AAPL ที่ถือ', before: '10', after: '20' },
      { label: 'ทุนเฉลี่ย (USD)', before: '100', after: '110' },
      { label: 'เรทเฉลี่ยตอนซื้อ', before: '35', after: '33.9091', fx: true },
    ])
    expect(warning).toBeNull()
  })

  it('warns when cash in an account that records deposits would go negative', () => {
    const deposit = makeTx({
      type: 'deposit',
      instrumentId: undefined,
      quantity: undefined,
      price: undefined,
      amount: '500',
      date: '2024-01-05',
    })
    const tx = makeTx({ quantity: '10', price: '100', date: '2024-01-10' })
    const { rows, warning } = previewAfterSave([deposit], tx, 'THB', 'AAPL')
    expect(rows).toContainEqual({ label: 'เงินสด USD', before: '500.00', after: '−500.00' })
    expect(warning).toBe('เงินสด USD จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?')
  })

  it('stays quiet for an account that only records trades', () => {
    const tx = makeTx({ quantity: '10', price: '100', date: '2024-01-10' })
    const { rows, warning } = previewAfterSave([], tx, 'THB', 'AAPL')
    expect(rows.map((row) => row.label)).not.toContain('เงินสด USD')
    expect(warning).toBeNull()
  })

  it('compares an edited transaction against its saved version', () => {
    const saved = makeTx({ id: 'buy-1', quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' })
    const edited = { ...saved, quantity: '12' }
    const { rows } = previewAfterSave([], edited, 'THB', 'AAPL', saved)
    expect(rows[0]).toEqual({ label: 'AAPL ที่ถือ', before: '10', after: '12' })
  })

  it('does not warn about cash that the saved version already pushed below zero', () => {
    const deposit = makeTx({
      type: 'deposit',
      instrumentId: undefined,
      quantity: undefined,
      price: undefined,
      amount: '500',
      date: '2024-01-05',
    })
    const saved = makeTx({ id: 'buy-1', quantity: '10', price: '100', date: '2024-01-10' })
    const { rows, warning } = previewAfterSave([deposit], { ...saved, note: 'edited' }, 'THB', 'AAPL', saved)
    expect(rows.map((row) => row.label)).not.toContain('เงินสด USD')
    expect(warning).toBeNull()
  })
})

describe('previewAfterSave for a transfer', () => {
  const names = new Map([
    ['acc-1', 'Dime US'],
    ['acc-2', 'IBKR'],
  ])
  const buy = makeTx({ quantity: '10', price: '100', fxRate: '35', date: '2024-01-10' })
  const cash = { instrumentId: undefined, quantity: undefined, price: undefined }
  const deposit = makeTx({ ...cash, type: 'deposit', amount: '500', currency: 'THB', fxRate: '1', fxSource: 'same', date: '2024-01-05' })
  const sendCash = (amount: string) =>
    makeTx({ ...cash, type: 'transfer', toAccountId: 'acc-2', amount, currency: 'THB', fxRate: '1', fxSource: 'same', date: '2024-02-01' })

  it('shows the holding on both sides of a share transfer', () => {
    const tx = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '4', price: undefined, date: '2024-02-01' })
    const { rows, warning } = previewAfterSave([buy], tx, 'THB', 'AAPL', undefined, names)
    expect(rows).toEqual([
      { label: 'AAPL · Dime US', before: '10', after: '6' },
      { label: 'AAPL · IBKR', before: '0', after: '4' },
    ])
    expect(warning).toBeNull()
  })

  it('adds the fee to the sending account when it records cash', () => {
    const usd = makeTx({ ...cash, type: 'deposit', amount: '2000', date: '2024-01-05' })
    const tx = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '4', price: undefined, fees: '2', date: '2024-02-01' })
    const { rows } = previewAfterSave([usd, buy], tx, 'THB', 'AAPL', undefined, names)
    expect(rows.map((row) => row.label)).toEqual(['AAPL · Dime US', 'AAPL · IBKR', 'เงินสด USD · Dime US'])
    expect(rows[2]).toMatchObject({ before: '1,000.00', after: '998.00' })
  })

  it('shows the cash of both accounts for a cash transfer and warns when the sender would go negative', () => {
    const { rows, warning } = previewAfterSave([deposit], sendCash('800'), 'THB', '', undefined, names)
    expect(rows).toEqual([
      { label: 'เงินสด THB · Dime US', before: '500.00', after: '−300.00' },
      { label: 'เงินสด THB · IBKR', before: '0.00', after: '800.00' },
    ])
    expect(warning).toBe('เงินสด THB จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?')
  })

  it('still shows both sides when the sender only records trades, without a warning', () => {
    const { rows, warning } = previewAfterSave([], sendCash('800'), 'THB', '', undefined, names)
    expect(rows.map((row) => row.label)).toEqual(['เงินสด THB · Dime US', 'เงินสด THB · IBKR'])
    expect(warning).toBeNull()
  })

  it('compares an edited transfer against its saved version', () => {
    const saved = { ...sendCash('300'), id: 'move-1' }
    const { rows } = previewAfterSave([deposit], { ...saved, amount: '400' }, 'THB', '', saved, names)
    expect(rows[1]).toEqual({ label: 'เงินสด THB · IBKR', before: '300.00', after: '400.00' })
  })
})

describe('previewAfterSave for a swap', () => {
  const buyBtc = makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
  const swap = (overrides: Partial<Transaction> = {}) =>
    makeTx({
      type: 'swap',
      instrumentId: 'CRYPTO:BTC',
      quantity: '0.01',
      price: undefined,
      toInstrumentId: 'CRYPTO:ETH',
      toQuantity: '0.25',
      amount: '660',
      fxRate: '35',
      date: '2024-04-01',
      ...overrides,
    })

  it('shows the coin given up and then the coin received', () => {
    const { rows, warning } = previewAfterSave([buyBtc], swap(), 'THB', 'BTC')
    expect(rows).toEqual([
      { label: 'BTC ที่ถือ', before: '0.01', after: '0' },
      { label: 'ทุนเฉลี่ย BTC (USD)', before: '58,000', after: '—' },
      { label: 'เรทเฉลี่ยตอนซื้อ BTC', before: '34', after: '—', fx: true },
      { label: 'ETH ที่ถือ', before: '0', after: '0.25' },
      { label: 'ทุนเฉลี่ย ETH (USD)', before: '—', after: '2,640' },
      { label: 'เรทเฉลี่ยตอนซื้อ ETH', before: '—', after: '35', fx: true },
    ])
    expect(warning).toBeNull()
  })

  it('names the coin on every row and keeps the rows of each coin together', () => {
    const { rows } = previewAfterSave([buyBtc], swap(), 'THB', 'BTC')
    expect(rows.map((row) => row.label)).toEqual([
      'BTC ที่ถือ',
      'ทุนเฉลี่ย BTC (USD)',
      'เรทเฉลี่ยตอนซื้อ BTC',
      'ETH ที่ถือ',
      'ทุนเฉลี่ย ETH (USD)',
      'เรทเฉลี่ยตอนซื้อ ETH',
    ])
  })

  it('leaves out the rate rows when the swap is valued in the base currency', () => {
    const inBaht = { currency: 'THB', fxRate: '1', fxSource: 'same' as const }
    const { rows } = previewAfterSave([{ ...buyBtc, ...inBaht }], swap(inBaht), 'THB', 'BTC')
    expect(rows.map((row) => row.label)).toEqual(['BTC ที่ถือ', 'ทุนเฉลี่ย BTC (THB)', 'ETH ที่ถือ', 'ทุนเฉลี่ย ETH (THB)'])
  })

  it('adds the coin received to what is already held', () => {
    const eth = makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '33', date: '2024-02-01' })
    const { rows } = previewAfterSave([eth, buyBtc], swap({ quantity: '0.004', toQuantity: '0.1', amount: '264' }), 'THB', 'BTC')
    expect(rows[0]).toEqual({ label: 'BTC ที่ถือ', before: '0.01', after: '0.006' })
    expect(rows.find((row) => row.label === 'ETH ที่ถือ')).toEqual({ label: 'ETH ที่ถือ', before: '1', after: '1.1' })
  })

  it('shows the fee paid in cash only for an account that records cash', () => {
    const deposit = makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '100', date: '2024-01-05' })
    const { rows } = previewAfterSave([deposit, buyBtc], swap({ fees: '2' }), 'THB', 'BTC')
    expect(rows[rows.length - 1]).toEqual({ label: 'เงินสด USD', before: '−480.00', after: '−482.00' })
    const free = previewAfterSave([deposit, buyBtc], swap(), 'THB', 'BTC').rows.map((row) => row.label)
    expect(free).not.toContain('เงินสด USD')
  })

  it('gives the cost of each unit received and the gain on the coin given up', () => {
    const outcome = previewAfterSave([buyBtc], swap({ fees: '1.5' }), 'THB', 'BTC').swap
    expect(outcome?.unitCost.toString()).toBe('2646')
    expect(outcome?.realizedQuote.toString()).toBe('80')
    const loss = previewAfterSave([buyBtc], swap({ amount: '500' }), 'THB', 'BTC').swap
    expect(loss?.realizedQuote.toString()).toBe('-80')
  })

  it('gives no outcome for other types or for a swap the ledger would skip', () => {
    expect(previewAfterSave([], makeTx({ quantity: '1', price: '100' }), 'THB', 'AAPL').swap).toBeNull()
    expect(previewAfterSave([buyBtc], swap({ quantity: '0.02' }), 'THB', 'BTC').swap).toBeNull()
  })

  it('compares an edited swap against its saved version', () => {
    const saved = swap({ id: 'swap-1' })
    const { rows, swap: outcome } = previewAfterSave([buyBtc], { ...saved, toQuantity: '0.3' }, 'THB', 'BTC', saved)
    expect(rows[0]).toEqual({ label: 'BTC ที่ถือ', before: '0', after: '0' })
    expect(rows.find((row) => row.label === 'ETH ที่ถือ')).toEqual({ label: 'ETH ที่ถือ', before: '0.25', after: '0.3' })
    expect(outcome?.unitCost.toString()).toBe('2200')
  })
})

describe('previewAfterSave for a fee paid in an asset', () => {
  const bnbFee = { feePaidIn: 'asset' as const, feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' }
  const buyBnb = makeTx({ instrumentId: 'CRYPTO:BNB', quantity: '1', price: '500', fxRate: '34', date: '2024-01-10' })
  const buyEth = (overrides: Partial<Transaction> = {}) =>
    makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '34', date: '2024-01-11', ...overrides })

  it('shows what is left of the asset the fee was paid in after the rows of the asset traded', () => {
    const { rows } = previewAfterSave([buyBnb], buyEth(bnbFee), 'THB', 'ETH')
    expect(rows.map((row) => row.label)).toEqual(['ETH ที่ถือ', 'ทุนเฉลี่ย (USD)', 'เรทเฉลี่ยตอนซื้อ', 'BNB ที่ถือ'])
    expect(rows[rows.length - 1]).toEqual({ label: 'BNB ที่ถือ', before: '1', after: '0.999' })
  })

  it('shows the asset a sell paid its fee in', () => {
    const held = makeTx({ instrumentId: 'CRYPTO:ETH', quantity: '1', price: '2000', fxRate: '34', date: '2024-01-09' })
    const sell = buyEth({ type: 'sell', price: '2500', ...bnbFee })
    expect(previewAfterSave([held, buyBnb], sell, 'THB', 'ETH').rows.at(-1)).toEqual({ label: 'BNB ที่ถือ', before: '1', after: '0.999' })
  })

  it('shows it after both coins of a swap', () => {
    const buyBtc = makeTx({ instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: '58000', fxRate: '34', date: '2024-03-01' })
    const swap = makeTx({ type: 'swap', instrumentId: 'CRYPTO:BTC', quantity: '0.01', price: undefined, toInstrumentId: 'CRYPTO:ETH', toQuantity: '0.25', amount: '660', fxRate: '35', date: '2024-04-01', ...bnbFee })
    const labels = previewAfterSave([buyBtc, buyBnb], swap, 'THB', 'BTC').rows.map((row) => row.label)
    expect(labels.slice(-2)).toEqual(['เรทเฉลี่ยตอนซื้อ ETH', 'BNB ที่ถือ'])
  })

  it('compares an edited fee against the saved one', () => {
    const saved = buyEth({ id: 'buy-eth', ...bnbFee })
    const { rows } = previewAfterSave([buyBnb], { ...saved, feeQuantity: '0.002' }, 'THB', 'ETH', saved)
    expect(rows.at(-1)).toEqual({ label: 'BNB ที่ถือ', before: '0.999', after: '0.998' })
  })

  it('adds no such row when the fee is paid in cash or taken from the coins received', () => {
    expect(previewAfterSave([buyBnb], buyEth({ fees: '1' }), 'THB', 'ETH').rows.map((row) => row.label)).not.toContain('BNB ที่ถือ')
    const received = previewAfterSave([], buyEth({ feePaidIn: 'received', feeQuantity: '0.001' }), 'THB', 'ETH')
    expect(received.rows[0]).toEqual({ label: 'ETH ที่ถือ', before: '0', after: '0.999' })
    expect(received.rows).toHaveLength(3)
  })

  it('shows nothing changing when the ledger would refuse the fee', () => {
    const { rows } = previewAfterSave([], buyEth(bnbFee), 'THB', 'ETH')
    expect(rows[0]).toEqual({ label: 'ETH ที่ถือ', before: '0', after: '0' })
    expect(rows.at(-1)).toEqual({ label: 'BNB ที่ถือ', before: '0', after: '0' })
  })

  describe('a transaction saved together with others', () => {
    const deposit = makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '100', date: '2024-01-02' })
    const dividend = makeTx({ type: 'dividend', instrumentId: 'US:VOO', quantity: undefined, price: undefined, amount: '10', tax: '1.5', fxRate: '34', date: '2024-03-28' })
    const buy = makeTx({ instrumentId: 'US:VOO', quantity: '0.016', price: '500', fxRate: '34', date: '2024-03-28' })

    it('counts the transactions saved alongside in the holding and the cash', () => {
      const { rows } = previewAfterSave([deposit], dividend, 'THB', 'VOO', undefined, undefined, [buy])
      expect(rows).toContainEqual({ label: 'VOO ที่ถือ', before: '0', after: '0.016' })
      expect(rows).toContainEqual({ label: 'เงินสด USD', before: '100.00', after: '100.50' })
    })

    it('shows only the dividend when nothing is saved alongside', () => {
      const { rows } = previewAfterSave([deposit], dividend, 'THB', 'VOO')
      expect(rows).toContainEqual({ label: 'VOO ที่ถือ', before: '0', after: '0' })
      expect(rows).toContainEqual({ label: 'เงินสด USD', before: '100.00', after: '108.50' })
    })

    it('warns about cash that the whole set takes below zero', () => {
      const { warning } = previewAfterSave([deposit], dividend, 'THB', 'VOO', undefined, undefined, [{ ...buy, quantity: '1' }])
      expect(warning).toBe('เงินสด USD จะติดลบ · ลืมบันทึกการแลกเงินหรือฝากเงินหรือเปล่า?')
    })
  })
})
