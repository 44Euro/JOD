import { describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { validateTransaction } from './validation'

const TODAY = '2024-06-30'

describe('validateTransaction', () => {
  it('accepts a complete buy', () => {
    expect(validateTransaction(makeTx(), TODAY)).toEqual([])
  })

  it('rejects zero quantity, negative fees and a missing instrument', () => {
    const errors = validateTransaction(makeTx({ quantity: '0', fees: '-1', instrumentId: undefined }), TODAY)
    expect(errors).toContain('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')
    expect(errors).toContain('ค่าธรรมเนียมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
    expect(errors).toContain('กรุณาระบุหุ้น/สินทรัพย์')
  })

  it('rejects impossible and future dates', () => {
    expect(validateTransaction(makeTx({ date: '2024-02-30' }), TODAY)).toContain('วันที่ไม่ถูกต้อง')
    expect(validateTransaction(makeTx({ date: '2024-07-01' }), TODAY)).toContain('วันที่ต้องไม่เกินวันนี้')
  })

  it('rejects a missing FX rate and numbers that are not plain decimals', () => {
    const errors = validateTransaction(makeTx({ fxRate: '', price: '1e3' }), TODAY)
    expect(errors).toContain('เรทแลกเปลี่ยนต้องเป็นตัวเลขมากกว่า 0')
    expect(errors).toContain('ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
  })

  it('requires a different target currency for conversions', () => {
    const tx = makeTx({ type: 'fx_convert', currency: 'THB', amount: '100', toCurrency: 'THB', toAmount: '3' })
    expect(validateTransaction(tx, TODAY)).toContain('สกุลเงินปลายทางต้องต่างจากต้นทาง')
  })

  it('rejects an exchange fee that takes the whole amount exchanged', () => {
    const tx = makeTx({ type: 'fx_convert', currency: 'THB', amount: '100', fees: '100', toCurrency: 'USD', toAmount: '3' })
    expect(validateTransaction(tx, TODAY)).toEqual(['ค่าธรรมเนียมต้องน้อยกว่าจำนวนเงินต้นทาง'])
    expect(validateTransaction({ ...tx, fees: '99.99' }, TODAY)).toEqual([])
    expect(validateTransaction({ ...tx, amount: undefined, fees: '100' }, TODAY)).not.toContain(
      'ค่าธรรมเนียมต้องน้อยกว่าจำนวนเงินต้นทาง',
    )
  })

  it('requires an amount for deposits', () => {
    const tx = makeTx({ type: 'deposit', amount: undefined, instrumentId: undefined })
    expect(validateTransaction(tx, TODAY)).toEqual(['จำนวนเงินต้องเป็นตัวเลขมากกว่า 0'])
  })

  it('requires quantity for an opening holding and an amount for opening cash', () => {
    expect(validateTransaction(makeTx({ type: 'opening', quantity: undefined }), TODAY)).toContain(
      'จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0',
    )
    const cash = makeTx({ type: 'opening', instrumentId: undefined, quantity: undefined, price: undefined })
    expect(validateTransaction(cash, TODAY)).toEqual(['จำนวนเงินต้องเป็นตัวเลขมากกว่า 0'])
  })

  it('requires a tax year when a withdrawal is sent back to Thailand', () => {
    const tx = makeTx({ type: 'withdraw', instrumentId: undefined, amount: '500', remitToThailand: true })
    expect(validateTransaction(tx, TODAY)).toEqual(['ปีภาษีไม่ถูกต้อง'])
    expect(validateTransaction({ ...tx, taxYear: 2024 }, TODAY)).toEqual([])
  })

  it('accepts interest without an instrument', () => {
    expect(validateTransaction(makeTx({ type: 'interest', instrumentId: undefined, amount: '2' }), TODAY)).toEqual([])
  })

  it('needs a different receiving account for a transfer', () => {
    const base = makeTx({ type: 'transfer', quantity: '4', price: undefined })
    expect(validateTransaction(base, TODAY)).toContain('กรุณาเลือกบัญชีปลายทาง')
    expect(validateTransaction({ ...base, toAccountId: 'acc-1' }, TODAY)).toContain('บัญชีปลายทางต้องต่างจากบัญชีต้นทาง')
    expect(validateTransaction({ ...base, toAccountId: 'acc-2', quantity: '0' }, TODAY)).toContain('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')
    expect(validateTransaction({ ...base, toAccountId: 'acc-2', instrumentId: undefined, quantity: undefined }, TODAY)).toContain(
      'จำนวนเงินต้องเป็นตัวเลขมากกว่า 0',
    )
    expect(validateTransaction({ ...base, toAccountId: 'acc-2' }, TODAY)).toEqual([])
  })

  describe('receive_asset', () => {
    const received = makeTx({ type: 'receive_asset', receiveKind: 'staking', instrumentId: 'CRYPTO:SOL', quantity: '0.5', price: '150' })

    it('accepts a complete asset received, in every kind', () => {
      expect(validateTransaction(received, TODAY)).toEqual([])
      for (const receiveKind of ['stock_dividend', 'staking', 'airdrop', 'coin_interest', 'other'] as const) {
        expect(validateTransaction({ ...received, receiveKind }, TODAY)).toEqual([])
      }
    })

    it('accepts an airdrop that has no value yet', () => {
      expect(validateTransaction({ ...received, receiveKind: 'airdrop', price: '0' }, TODAY)).toEqual([])
    })

    it('needs the asset, a positive quantity and a value of zero or more', () => {
      expect(validateTransaction({ ...received, instrumentId: undefined }, TODAY)).toEqual(['กรุณาระบุหุ้น/สินทรัพย์'])
      expect(validateTransaction({ ...received, quantity: '0' }, TODAY)).toEqual(['จำนวนที่ได้รับต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...received, price: '-1' }, TODAY)).toEqual(['มูลค่าต่อหน่วยต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'])
      expect(validateTransaction({ ...received, price: undefined }, TODAY)).toEqual(['มูลค่าต่อหน่วยต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'])
    })

    it('needs one of the known kinds', () => {
      expect(validateTransaction({ ...received, receiveKind: undefined }, TODAY)).toEqual(['ประเภทการรับไม่ถูกต้อง'])
      expect(validateTransaction({ ...received, receiveKind: 'gift' as never }, TODAY)).toEqual(['ประเภทการรับไม่ถูกต้อง'])
    })
  })

  describe('swap', () => {
    const swap = makeTx({
      type: 'swap',
      instrumentId: 'CRYPTO:BTC',
      quantity: '0.01',
      price: undefined,
      toInstrumentId: 'CRYPTO:ETH',
      toQuantity: '0.25',
      amount: '660',
    })

    it('accepts a complete swap', () => {
      expect(validateTransaction(swap, TODAY)).toEqual([])
    })

    it('needs the coin received and a different one from the coin given up', () => {
      expect(validateTransaction({ ...swap, toInstrumentId: undefined }, TODAY)).toEqual(['กรุณาระบุสินทรัพย์ที่ได้รับ'])
      expect(validateTransaction({ ...swap, toInstrumentId: 'CRYPTO:BTC' }, TODAY)).toEqual([
        'สินทรัพย์ที่ได้รับต้องต่างจากที่แลกออก',
      ])
    })

    it('needs the coin given up', () => {
      expect(validateTransaction({ ...swap, instrumentId: undefined }, TODAY)).toEqual(['กรุณาระบุสินทรัพย์ที่แลกออก'])
    })

    it('needs a positive quantity on both sides and a positive total value', () => {
      expect(validateTransaction({ ...swap, quantity: '0' }, TODAY)).toEqual(['จำนวนที่แลกออกต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...swap, toQuantity: '0' }, TODAY)).toEqual(['จำนวนที่ได้รับต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...swap, toQuantity: undefined }, TODAY)).toEqual(['จำนวนที่ได้รับต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...swap, amount: '0' }, TODAY)).toEqual(['มูลค่ารวมต้องเป็นตัวเลขมากกว่า 0'])
    })
  })

  describe('what a fee is paid in', () => {
    const swap = makeTx({
      type: 'swap',
      instrumentId: 'CRYPTO:BTC',
      quantity: '0.01',
      price: undefined,
      toInstrumentId: 'CRYPTO:ETH',
      toQuantity: '0.25',
      amount: '660',
    })
    const buyReceived = makeTx({ feePaidIn: 'received', feeQuantity: '0.001', quantity: '1' })
    const bnbFee = { feePaidIn: 'asset' as const, feeInstrumentId: 'CRYPTO:BNB', feeQuantity: '0.001', fees: '0.6' }
    const sellAsset = makeTx({ type: 'sell', ...bnbFee })
    const transfer = makeTx({ type: 'transfer', toAccountId: 'acc-2', quantity: '4', price: undefined })

    it('accepts a fee paid in cash, spelled out or not', () => {
      expect(validateTransaction(makeTx({ feePaidIn: 'cash' }), TODAY)).toEqual([])
      expect(validateTransaction(makeTx({ fees: '2' }), TODAY)).toEqual([])
    })

    it('accepts a fee taken from what a buy, a swap and a transfer of units receive', () => {
      expect(validateTransaction(buyReceived, TODAY)).toEqual([])
      expect(validateTransaction({ ...swap, feePaidIn: 'received', feeQuantity: '0.0025' }, TODAY)).toEqual([])
      expect(validateTransaction({ ...transfer, feePaidIn: 'received', feeQuantity: '0.1' }, TODAY)).toEqual([])
    })

    it('accepts a fee paid in another asset on a buy, a sell and a swap', () => {
      expect(validateTransaction(sellAsset, TODAY)).toEqual([])
      expect(validateTransaction({ ...sellAsset, type: 'buy' }, TODAY)).toEqual([])
      expect(validateTransaction({ ...swap, ...bnbFee }, TODAY)).toEqual([])
    })

    it('keeps a fee taken from what is received to a buy, a swap and a transfer of units', () => {
      const message = 'หักจากที่ได้รับใช้ได้กับการซื้อ แลกเหรียญ และโอนสินทรัพย์'
      expect(validateTransaction({ ...buyReceived, type: 'sell' }, TODAY)).toEqual([message])
      expect(validateTransaction({ ...transfer, instrumentId: undefined, quantity: undefined, amount: '100', feePaidIn: 'received', feeQuantity: '1' }, TODAY)).toEqual([message])
      expect(validateTransaction(makeTx({ type: 'dividend', amount: '5', feePaidIn: 'received', feeQuantity: '1' }), TODAY)).toEqual([message])
    })

    it('needs a positive number of units taken, as units, and fewer than the units received', () => {
      expect(validateTransaction({ ...buyReceived, feeQuantity: undefined }, TODAY)).toEqual(['จำนวนที่ถูกหักต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...buyReceived, feeQuantity: '0' }, TODAY)).toEqual(['จำนวนที่ถูกหักต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...buyReceived, fees: '1' }, TODAY)).toEqual(['ค่าธรรมเนียมที่หักจากที่ได้รับกรอกเป็นจำนวนหน่วย'])
      expect(validateTransaction({ ...buyReceived, feeQuantity: '1' }, TODAY)).toEqual(['ค่าธรรมเนียมต้องน้อยกว่าจำนวนที่ได้รับ'])
      expect(validateTransaction({ ...buyReceived, feeQuantity: '2' }, TODAY)).toEqual(['ค่าธรรมเนียมต้องน้อยกว่าจำนวนที่ได้รับ'])
      expect(validateTransaction({ ...buyReceived, feeQuantity: '0.999' }, TODAY)).toEqual([])
    })

    it('compares the units taken with the coin received by a swap, not the coin given up', () => {
      const received = { ...swap, feePaidIn: 'received' as const }
      expect(validateTransaction({ ...received, feeQuantity: '0.25' }, TODAY)).toEqual(['ค่าธรรมเนียมต้องน้อยกว่าจำนวนที่ได้รับ'])
      expect(validateTransaction({ ...received, feeQuantity: '0.02' }, TODAY)).toEqual([])
    })

    it('keeps a fee paid in another asset to a buy, a sell and a swap', () => {
      const message = 'จ่ายค่าธรรมเนียมเป็นสินทรัพย์อื่นใช้ได้กับการซื้อ ขาย และแลกเหรียญ'
      expect(validateTransaction({ ...transfer, ...bnbFee }, TODAY)).toEqual([message])
      expect(validateTransaction({ ...sellAsset, type: 'dividend', amount: '5' }, TODAY)).toEqual([message])
    })

    it('needs the asset, a positive number of units and a positive value for a fee paid in another asset', () => {
      expect(validateTransaction({ ...sellAsset, feeInstrumentId: undefined }, TODAY)).toEqual(['กรุณาระบุสินทรัพย์ที่ใช้จ่ายค่าธรรมเนียม'])
      expect(validateTransaction({ ...sellAsset, feeQuantity: '0' }, TODAY)).toEqual(['จำนวนที่จ่ายค่าธรรมเนียมต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...sellAsset, feeQuantity: undefined }, TODAY)).toEqual(['จำนวนที่จ่ายค่าธรรมเนียมต้องเป็นตัวเลขมากกว่า 0'])
      expect(validateTransaction({ ...sellAsset, fees: '0' }, TODAY)).toEqual(['มูลค่าค่าธรรมเนียมต้องเป็นตัวเลขมากกว่า 0'])
    })

    it('refuses to pay the fee with an asset of the transaction itself', () => {
      const message = 'สินทรัพย์ที่จ่ายค่าธรรมเนียมต้องต่างจากสินทรัพย์ของรายการ'
      expect(validateTransaction({ ...sellAsset, feeInstrumentId: 'US:AAPL' }, TODAY)).toEqual([message])
      const bySwap = { ...swap, ...bnbFee }
      expect(validateTransaction({ ...bySwap, feeInstrumentId: 'CRYPTO:BTC' }, TODAY)).toEqual([message])
      expect(validateTransaction({ ...bySwap, feeInstrumentId: 'CRYPTO:ETH' }, TODAY)).toEqual([message])
      expect(validateTransaction({ ...bySwap, feeInstrumentId: 'CRYPTO:BNB' }, TODAY)).toEqual([])
    })

    it('rejects a way of paying the fee that does not exist', () => {
      expect(validateTransaction(makeTx({ feePaidIn: 'gold' as never }), TODAY)).toEqual(['วิธีจ่ายค่าธรรมเนียมไม่ถูกต้อง'])
    })
  })
})
