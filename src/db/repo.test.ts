import { beforeEach, describe, expect, it } from 'vitest'
import { makeTx } from '../test/fixtures'
import { createDb, type JodDB } from './db'
import {
  addAccount,
  deleteAccount,
  getSettings,
  recordBenchmark,
  recordDailyValue,
  renameInstrument,
  restoreTransaction,
  saveInstrumentThesis,
  saveSettings,
  saveTradeReview,
  saveTransaction,
  saveTransactions,
  setInstrumentPrice,
  deletePlan,
  saveImport,
  savePlan,
  setTargetPct,
  undoImport,
  updateAccount,
  upsertInstrument,
} from './repo'

let db: JodDB

beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`)
})

describe('settings', () => {
  it('defaults to THB and persists changes', async () => {
    expect(await getSettings(db)).toEqual({ baseCurrency: 'THB' })
    await saveSettings(db, { baseCurrency: 'USD', lastBackupAt: '2024-06-01T00:00:00.000Z' })
    expect(await getSettings(db)).toEqual({ baseCurrency: 'USD', lastBackupAt: '2024-06-01T00:00:00.000Z' })
  })

  it('remembers whether to hide the numbers on launch', async () => {
    expect((await getSettings(db)).hideNumbersOnLaunch).toBeFalsy()
    await saveSettings(db, { baseCurrency: 'THB', hideNumbersOnLaunch: true })
    expect((await getSettings(db)).hideNumbersOnLaunch).toBe(true)
    await saveSettings(db, { baseCurrency: 'THB', hideNumbersOnLaunch: false })
    expect((await getSettings(db)).hideNumbersOnLaunch).toBe(false)
  })
})

describe('accounts', () => {
  it('refuses to delete an account that still has transactions', async () => {
    const account = await addAccount(db, { name: 'Dime US', broker: 'Dime', note: '' })
    await saveTransaction(db, makeTx({ accountId: account.id }))
    await expect(deleteAccount(db, account.id)).rejects.toThrow('ลบไม่ได้ บัญชีนี้ยังมี 1 รายการ')
    expect(await db.accounts.count()).toBe(1)
  })

  it('keeps an account that only receives transfers', async () => {
    await db.transactions.add(makeTx({ type: 'transfer', accountId: 'acc-1', toAccountId: 'acc-2', quantity: '1', price: undefined }))
    await expect(deleteAccount(db, 'acc-2')).rejects.toThrow('ลบไม่ได้ บัญชีนี้ยังมี 1 รายการ')
  })

  it('deletes an unused account', async () => {
    const account = await addAccount(db, { name: 'Empty', broker: '', note: '' })
    await deleteAccount(db, account.id)
    expect(await db.accounts.count()).toBe(0)
  })
})

describe('updateAccount', () => {
  const template = { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '' }

  it('saves the name, broker and fee formula', async () => {
    const account = await addAccount(db, { name: 'Streaming', broker: '', note: 'เก่า' })
    await updateAccount(db, account.id, { name: ' Streaming SET ', broker: 'Streaming', note: 'เก่า', feeTemplate: template })
    expect(await db.accounts.get(account.id)).toEqual({
      ...account,
      name: 'Streaming SET',
      broker: 'Streaming',
      feeTemplate: template,
    })
  })

  it('removes the formula when none is given', async () => {
    const account = await addAccount(db, { name: 'Streaming', broker: '', note: '' })
    await updateAccount(db, account.id, { name: 'Streaming', broker: '', note: '', feeTemplate: template })
    await updateAccount(db, account.id, { name: 'Streaming', broker: '', note: '', feeTemplate: undefined })
    expect(await db.accounts.get(account.id)).not.toHaveProperty('feeTemplate')
  })

  it('saves again without changes', async () => {
    const account = await addAccount(db, { name: 'Streaming', broker: 'Streaming', note: '' })
    await updateAccount(db, account.id, { name: 'Streaming', broker: 'Streaming', note: '', feeTemplate: undefined })
    expect(await db.accounts.get(account.id)).toEqual(account)
  })

  it('says so when the account is not there', async () => {
    await expect(updateAccount(db, 'ghost', { name: 'Streaming', broker: '', note: '', feeTemplate: undefined })).rejects.toThrow(
      'ไม่พบบัญชีนี้',
    )
    expect(await db.accounts.count()).toBe(0)
  })

  it('refuses an empty name', async () => {
    const account = await addAccount(db, { name: 'Streaming', broker: '', note: '' })
    await expect(updateAccount(db, account.id, { name: '  ', broker: '', note: '', feeTemplate: undefined })).rejects.toThrow('กรุณาตั้งชื่อบัญชี')
    expect((await db.accounts.get(account.id))?.name).toBe('Streaming')
  })

  it('refuses a wrong formula with its first problem and saves nothing', async () => {
    const account = await addAccount(db, { name: 'Streaming', broker: '', note: '' })
    const wrong = { ...template, commissionPct: '-1', vatPct: '200' }
    await expect(updateAccount(db, account.id, { name: 'Renamed', broker: '', note: '', feeTemplate: wrong })).rejects.toThrow(
      'ค่าคอมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
    )
    expect(await db.accounts.get(account.id)).toEqual(account)
  })
})

describe('instruments', () => {
  it('keeps the last price when instrument details are updated', async () => {
    const base = { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' } as const
    await upsertInstrument(db, base)
    await setInstrumentPrice(db, 'US:AAPL', '190.5', new Date('2024-05-01T00:00:00Z'))
    await upsertInstrument(db, { ...base, name: 'Apple Inc.' })
    const stored = await db.instruments.get('US:AAPL')
    expect(stored?.name).toBe('Apple Inc.')
    expect(stored?.lastPrice).toBe('190.5')
    expect(stored?.lastPriceAt).toBe('2024-05-01T00:00:00.000Z')
  })
})

describe('instrument thesis', () => {
  const base = { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard', assetType: 'etf', currency: 'USD' } as const

  it('stores the reason, target and review date, and removes fields that are cleared', async () => {
    await upsertInstrument(db, base)
    await saveInstrumentThesis(db, 'US:VOO', { holdReason: ' ถือยาว ', targetPrice: '600', reviewDate: '2027-01-01' })
    expect(await db.instruments.get('US:VOO')).toMatchObject({ holdReason: 'ถือยาว', targetPrice: '600', reviewDate: '2027-01-01' })

    await saveInstrumentThesis(db, 'US:VOO', { holdReason: 'ถือยาว', targetPrice: '', reviewDate: '' })
    const stored = await db.instruments.get('US:VOO')
    expect(stored).not.toHaveProperty('targetPrice')
    expect(stored).not.toHaveProperty('reviewDate')
  })

  it('keeps the thesis when the form updates the instrument details', async () => {
    await upsertInstrument(db, base)
    await saveInstrumentThesis(db, 'US:VOO', { holdReason: 'ถือยาว', targetPrice: '600', reviewDate: '' })
    await upsertInstrument(db, { ...base, name: 'Vanguard S&P 500 ETF' })
    expect((await db.instruments.get('US:VOO'))?.holdReason).toBe('ถือยาว')
  })

  it('refuses a bad target price or date, and an unknown instrument', async () => {
    await upsertInstrument(db, base)
    await expect(saveInstrumentThesis(db, 'US:VOO', { holdReason: '', targetPrice: '-1', reviewDate: '' })).rejects.toThrow(
      'ราคาเป้าหมายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
    )
    await expect(saveInstrumentThesis(db, 'US:VOO', { holdReason: '', targetPrice: '', reviewDate: '2027-02-30' })).rejects.toThrow(
      'วันทบทวนไม่ถูกต้อง',
    )
    await expect(saveInstrumentThesis(db, 'US:NOPE', { holdReason: 'x', targetPrice: '', reviewDate: '' })).rejects.toThrow('ไม่พบสินทรัพย์นี้')
  })
})

describe('renameInstrument', () => {
  const fb = { id: 'US:FB', market: 'US' as const, symbol: 'FB', name: 'Facebook', assetType: 'stock' as const, currency: 'USD', lastPrice: '300', holdReason: 'ads' }

  it('moves every transaction to the new symbol and remembers the old one', async () => {
    await db.instruments.add(fb)
    const plain = makeTx({ instrumentId: 'US:FB' })
    const swap = makeTx({ type: 'swap', instrumentId: 'US:AAPL', toInstrumentId: 'US:FB', quantity: '1', toQuantity: '1', amount: '100', price: undefined })
    const paid = makeTx({ instrumentId: 'US:AAPL', feePaidIn: 'asset', feeInstrumentId: 'US:FB', feeQuantity: '0.01', fees: '3' })
    await db.transactions.bulkAdd([plain, swap, paid])
    await expect(renameInstrument(db, 'US:FB', { symbol: 'meta', name: 'Meta Platforms' })).resolves.toBe('US:META')
    expect(await db.instruments.get('US:FB')).toBeUndefined()
    expect(await db.instruments.get('US:META')).toMatchObject({ symbol: 'META', name: 'Meta Platforms', lastPrice: '300', holdReason: 'ads', previousSymbols: ['FB'] })
    const ids = async (id: string) => {
      const t = await db.transactions.get(id)
      return [t?.instrumentId, t?.toInstrumentId, t?.feeInstrumentId]
    }
    expect(await ids(plain.id)).toEqual(['US:META', undefined, undefined])
    expect(await ids(swap.id)).toEqual(['US:AAPL', 'US:META', undefined])
    expect(await ids(paid.id)).toEqual(['US:AAPL', undefined, 'US:META'])
  })

  it('refuses a symbol that already exists and changes nothing', async () => {
    const meta = { ...fb, id: 'US:META', symbol: 'META', name: 'Meta' }
    const swap = makeTx({ type: 'swap', instrumentId: 'US:AAPL', toInstrumentId: 'US:FB', quantity: '1', toQuantity: '1', amount: '100', price: undefined })
    const paid = makeTx({ instrumentId: 'US:AAPL', feePaidIn: 'asset', feeInstrumentId: 'US:FB', feeQuantity: '0.01', fees: '3' })
    const txs = [makeTx({ instrumentId: 'US:FB' }), swap, paid]
    await db.instruments.bulkAdd([fb, meta])
    await db.transactions.bulkAdd(txs)
    await expect(renameInstrument(db, 'US:FB', { symbol: 'META', name: 'x' })).rejects.toThrow('มี META อยู่แล้ว · รวมสินทรัพย์สองตัวยังทำไม่ได้')
    expect(await db.instruments.orderBy('id').toArray()).toEqual([fb, meta])
    expect(await db.transactions.bulkGet(txs.map((t) => t.id))).toEqual(txs)
  })

  it('changes only the name when the symbol stays the same', async () => {
    await db.instruments.add(fb)
    await expect(renameInstrument(db, 'US:FB', { symbol: 'FB', name: 'Meta' })).resolves.toBe('US:FB')
    expect(await db.instruments.get('US:FB')).toMatchObject({ name: 'Meta' })
    expect((await db.instruments.get('US:FB'))?.previousSymbols).toBeUndefined()
  })

  it('changes only the unit in place and keeps everything else', async () => {
    await db.instruments.add(fb)
    await db.transactions.add(makeTx({ instrumentId: 'US:FB' }))
    await expect(renameInstrument(db, 'US:FB', { symbol: 'FB', name: 'Facebook', unit: 'unit' })).resolves.toBe('US:FB')
    expect(await db.instruments.get('US:FB')).toEqual({ ...fb, unit: 'unit' })
    expect((await db.transactions.toArray())[0].instrumentId).toBe('US:FB')
  })

  it('keeps the stored unit when none is given and carries it to the new symbol', async () => {
    await db.instruments.add({ ...fb, unit: 'coin' })
    await expect(renameInstrument(db, 'US:FB', { symbol: 'META', name: 'Meta' })).resolves.toBe('US:META')
    expect(await db.instruments.get('US:META')).toMatchObject({ unit: 'coin' })
    await renameInstrument(db, 'US:META', { symbol: 'META', name: 'Meta', unit: 'gram' })
    expect(await db.instruments.get('US:META')).toMatchObject({ unit: 'gram', previousSymbols: ['FB'] })
  })

  it('never lists the current symbol among the old ones when an asset goes back to a symbol', async () => {
    await db.instruments.add(fb)
    await renameInstrument(db, 'US:FB', { symbol: 'META', name: 'Meta' })
    await renameInstrument(db, 'US:META', { symbol: 'FB', name: 'Meta' })
    expect(await db.instruments.get('US:FB')).toMatchObject({ symbol: 'FB', previousSymbols: ['META'] })
    await renameInstrument(db, 'US:FB', { symbol: 'META', name: 'Meta' })
    expect(await db.instruments.get('US:META')).toMatchObject({ symbol: 'META', previousSymbols: ['FB'] })
  })

  it('edits the name or unit of an instrument whose old symbol would not pass today', async () => {
    const legacy = { ...fb, id: 'US:ME TA', symbol: 'ME TA', name: 'Meta' }
    await db.instruments.add(legacy)
    await expect(renameInstrument(db, 'US:ME TA', { symbol: 'ME TA', name: 'Meta Platforms', unit: 'unit' })).resolves.toBe('US:ME TA')
    expect(await db.instruments.get('US:ME TA')).toEqual({ ...legacy, name: 'Meta Platforms', unit: 'unit' })
    await expect(renameInstrument(db, 'US:ME TA', { symbol: 'ME  TA', name: 'x' })).rejects.toThrow('สัญลักษณ์ห้ามมีช่องว่างหรือเครื่องหมาย :')
  })

  it('does not leave the old symbol behind as the name of an asset that never had one', async () => {
    await db.instruments.add({ ...fb, name: 'FB' })
    await renameInstrument(db, 'US:FB', { symbol: 'META', name: 'FB' })
    expect(await db.instruments.get('US:META')).toMatchObject({ symbol: 'META', name: 'META', previousSymbols: ['FB'] })
    await db.instruments.add({ ...fb, id: 'US:AAPL', symbol: 'AAPL', name: 'AAPL' })
    await renameInstrument(db, 'US:AAPL', { symbol: 'APPLE', name: 'Apple' })
    expect(await db.instruments.get('US:APPLE')).toMatchObject({ name: 'Apple' })
  })

  it('keeps a name that is not the old symbol', async () => {
    await db.instruments.add(fb)
    await renameInstrument(db, 'US:FB', { symbol: 'META', name: 'Facebook' })
    expect(await db.instruments.get('US:META')).toMatchObject({ name: 'Facebook' })
  })

  it('keeps a trail when an asset is renamed more than once', async () => {
    await db.instruments.add(fb)
    await renameInstrument(db, 'US:FB', { symbol: 'META', name: 'Meta' })
    await renameInstrument(db, 'US:META', { symbol: 'MVRS', name: 'Meta' })
    expect(await db.instruments.get('US:MVRS')).toMatchObject({ symbol: 'MVRS', previousSymbols: ['FB', 'META'] })
  })

  it('refuses a bad symbol before touching anything', async () => {
    await db.instruments.add(fb)
    await expect(renameInstrument(db, 'US:FB', { symbol: ' ', name: 'x' })).rejects.toThrow('กรุณาระบุสัญลักษณ์')
    await expect(renameInstrument(db, 'US:FB', { symbol: 'ME TA', name: 'x' })).rejects.toThrow('สัญลักษณ์ห้ามมีช่องว่างหรือเครื่องหมาย :')
    expect(await db.instruments.get('US:FB')).toEqual(fb)
  })

  it('says so when the asset is not there', async () => {
    await expect(renameInstrument(db, 'US:NOPE', { symbol: 'META', name: 'Meta' })).rejects.toThrow('ไม่พบสินทรัพย์นี้')
    await expect(renameInstrument(db, 'US:NOPE', { symbol: ' ', name: 'Meta' })).rejects.toThrow('ไม่พบสินทรัพย์นี้')
    expect(await db.instruments.count()).toBe(0)
  })
})

describe('transactions', () => {
  it('rejects an invalid transaction instead of storing it', async () => {
    await expect(saveTransaction(db, makeTx({ quantity: '0' }))).rejects.toThrow('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')
    expect(await db.transactions.count()).toBe(0)
  })

  it('stamps updatedAt on save', async () => {
    const tx = makeTx()
    await saveTransaction(db, tx, new Date('2024-06-01T10:00:00Z'))
    expect((await db.transactions.get(tx.id))?.updatedAt).toBe('2024-06-01T10:00:00.000Z')
  })

  it('saves a dividend and its reinvested buy together or not at all', async () => {
    const dividend = makeTx({ type: 'dividend', quantity: undefined, price: undefined, amount: '10' })
    const buy = makeTx({ quantity: '0.016', price: '500' })
    await saveTransactions(db, [dividend, buy], new Date('2024-06-01T10:00:00Z'))
    expect(await db.transactions.count()).toBe(2)
    expect((await db.transactions.get(buy.id))?.updatedAt).toBe('2024-06-01T10:00:00.000Z')

    await db.transactions.clear()
    await expect(saveTransactions(db, [dividend, makeTx({ quantity: '0' })])).rejects.toThrow('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')
    expect(await db.transactions.count()).toBe(0)
  })

  it('writes nothing when the database refuses the second transaction', async () => {
    const withoutKey = { ...makeTx(), id: undefined as unknown as string }
    await expect(saveTransactions(db, [makeTx(), withoutKey])).rejects.toThrow()
    expect(await db.transactions.count()).toBe(0)
  })
})

describe('restoreTransaction', () => {
  it('puts the record back whole, with its own timestamps', async () => {
    const tx = makeTx({ note: 'back' })
    await restoreTransaction(db, tx)
    expect(await db.transactions.get(tx.id)).toEqual(tx)
  })

  it('refuses an id that is taken and leaves the stored record alone', async () => {
    const tx = makeTx({ note: 'original' })
    await saveTransaction(db, tx)
    await expect(restoreTransaction(db, { ...tx, note: 'other' })).rejects.toThrow('รายการนี้มีอยู่แล้ว')
    expect((await db.transactions.get(tx.id))!.note).toBe('original')
  })
})

describe('daily values', () => {
  it('keeps one row per day and only rewrites it when the numbers change', async () => {
    const day = { date: '2024-07-01', valueBase: '50950.00', netInvestedBase: '50000.00' }
    expect(await recordDailyValue(db, day, new Date('2024-07-01T02:00:00Z'))).toBe(true)
    expect(await recordDailyValue(db, day, new Date('2024-07-01T03:00:00Z'))).toBe(false)
    expect((await db.dailyValues.get('2024-07-01'))?.recordedAt).toBe('2024-07-01T02:00:00.000Z')

    expect(await recordDailyValue(db, { ...day, valueBase: '51000.00' }, new Date('2024-07-01T09:00:00Z'))).toBe(true)
    expect(await db.dailyValues.toArray()).toEqual([
      { date: '2024-07-01', valueBase: '51000.00', netInvestedBase: '50000.00', recordedAt: '2024-07-01T09:00:00.000Z' },
    ])
  })
})

describe('saveTradeReview', () => {
  const now = new Date('2024-06-02T08:00:00Z')

  it('adds the review, mistakes and score to the journal the sell already has', async () => {
    const sell = makeTx({ type: 'sell', journal: { strategy: 'Breakout', emotion: 'calm' } })
    await db.transactions.add(sell)
    await saveTradeReview(db, sell.id, { review: ' ออกเร็วไป ', mistakes: ['chased', 'sold_early'], score: 3 }, now)
    expect(await db.transactions.get(sell.id)).toEqual({
      ...sell,
      journal: { strategy: 'Breakout', emotion: 'calm', review: 'ออกเร็วไป', mistakes: ['chased', 'sold_early'], score: 3 },
      updatedAt: '2024-06-02T08:00:00.000Z',
    })
  })

  it('starts a journal on a sell that has none', async () => {
    const sell = makeTx({ type: 'sell' })
    await db.transactions.add(sell)
    await saveTradeReview(db, sell.id, { review: 'ok', mistakes: [] })
    expect((await db.transactions.get(sell.id))?.journal).toEqual({ review: 'ok' })
  })

  it('removes what the review no longer says and leaves the rest', async () => {
    const sell = makeTx({ type: 'sell', journal: { strategy: 'Breakout', review: 'เก่า', mistakes: ['chased'], score: 2 } })
    await db.transactions.add(sell)
    await saveTradeReview(db, sell.id, { review: '  ', mistakes: [] })
    const journal = (await db.transactions.get(sell.id))?.journal
    expect(journal).toEqual({ strategy: 'Breakout' })
    expect(journal).not.toHaveProperty('score')
  })

  it('leaves no journal behind when nothing is left in it', async () => {
    const sell = makeTx({ type: 'sell', journal: { review: 'เก่า' } })
    await db.transactions.add(sell)
    await saveTradeReview(db, sell.id, { review: '', mistakes: [] })
    expect(await db.transactions.get(sell.id)).not.toHaveProperty('journal')
  })

  it('refuses a score outside 1–5 and writes nothing', async () => {
    const sell = makeTx({ type: 'sell', journal: { strategy: 'Breakout' } })
    await db.transactions.add(sell)
    await expect(saveTradeReview(db, sell.id, { review: 'x', mistakes: [], score: 7 })).rejects.toThrow('คะแนนการลงมือต้องเป็น 1–5')
    expect(await db.transactions.get(sell.id)).toEqual(sell)
  })

  it('says so when the transaction is not there', async () => {
    await expect(saveTradeReview(db, 'missing', { review: 'x', mistakes: [] })).rejects.toThrow('ไม่พบรายการนี้')
  })

  it('writes a review only on a sell, because no other transaction keeps one through a restore', async () => {
    const buy = makeTx({ type: 'buy' })
    const swap = makeTx({ type: 'swap', instrumentId: 'CRYPTO:BTC', toInstrumentId: 'CRYPTO:ETH', quantity: '1', toQuantity: '10', amount: '660', price: undefined })
    await db.transactions.bulkAdd([buy, swap])
    for (const tx of [buy, swap]) {
      await expect(saveTradeReview(db, tx.id, { review: 'x', mistakes: ['chased'], score: 3 })).rejects.toThrow('รีวิวได้เฉพาะรายการขาย')
      expect(await db.transactions.get(tx.id)).toEqual(tx)
    }
  })

  it('refuses a review that would leave the sell itself invalid', async () => {
    const sell = makeTx({ type: 'sell', quantity: '0' })
    await db.transactions.add(sell)
    await expect(saveTradeReview(db, sell.id, { review: 'x', mistakes: [] })).rejects.toThrow('จำนวนหน่วยต้องเป็นตัวเลขมากกว่า 0')
    expect(await db.transactions.get(sell.id)).toEqual(sell)
  })
})

describe('imports', () => {
  const batch = { id: 'b1', accountId: 'acc-1', source: 'portfolio' as const, fileCount: 2, count: 2, createdInstrumentIds: ['US:VOO'], createdAt: '2026-10-25T00:00:00.000Z' }
  const voo = { id: 'US:VOO', market: 'US' as const, symbol: 'VOO', name: 'VOO', assetType: 'etf' as const, currency: 'USD' }

  it('writes the batch, its instruments and its records together, each record tagged with the batch', async () => {
    const txs = [makeTx({ id: 'i1', instrumentId: 'US:VOO' }), makeTx({ id: 'i2', instrumentId: 'US:VOO' })]
    await saveImport(db, batch, txs, [voo])
    expect(await db.imports.get('b1')).toEqual(batch)
    expect(await db.instruments.get('US:VOO')).toEqual(voo)
    expect((await db.transactions.toArray()).map((t) => t.importBatchId)).toEqual(['b1', 'b1'])
  })

  it('writes nothing when one record is invalid', async () => {
    await expect(saveImport(db, batch, [makeTx({ id: 'ok' }), makeTx({ id: 'bad', quantity: '-1' })], [voo])).rejects.toThrow()
    expect(await db.imports.count()).toBe(0)
    expect(await db.transactions.count()).toBe(0)
    expect(await db.instruments.count()).toBe(0)
  })

  it('takes back the whole batch and the instruments only it used, keeping everything else', async () => {
    await db.transactions.add(makeTx({ id: 'mine', instrumentId: 'US:AAPL' }))
    await saveImport(db, { ...batch, createdInstrumentIds: ['US:VOO', 'US:AAPL'] }, [makeTx({ id: 'i1', instrumentId: 'US:VOO' }), makeTx({ id: 'i2', instrumentId: 'US:AAPL' })], [
      voo,
      { ...voo, id: 'US:AAPL', symbol: 'AAPL', name: 'AAPL', assetType: 'stock' },
    ])
    expect(await undoImport(db, 'b1')).toBe(2)
    expect((await db.transactions.toArray()).map((t) => t.id)).toEqual(['mine'])
    expect((await db.instruments.toArray()).map((i) => i.id)).toEqual(['US:AAPL'])
    expect(await db.imports.count()).toBe(0)
  })
})

describe('targets and plans', () => {
  const plan = { id: 'p1', accountId: 'acc-1', instrumentId: 'US:VOO', amount: '100', currency: 'USD', frequency: 'monthly' as const, startDate: '2026-01-05', createdAt: '' }

  it('sets and clears a target share, refusing one above 100%', async () => {
    await db.instruments.add({ id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'VOO', assetType: 'etf', currency: 'USD' })
    await setTargetPct(db, 'US:VOO', '40.0')
    expect((await db.instruments.get('US:VOO'))?.targetPct).toBe('40')
    await expect(setTargetPct(db, 'US:VOO', '120')).rejects.toThrow('0–100%')
    await setTargetPct(db, 'US:VOO', '')
    expect((await db.instruments.get('US:VOO'))?.targetPct).toBeUndefined()
  })

  it('saves a valid plan only, and deletes it', async () => {
    await expect(savePlan(db, { ...plan, amount: '0' })).rejects.toThrow('จำนวนเงินต่องวดต้องมากกว่า 0')
    await savePlan(db, plan)
    expect(await db.plans.get('p1')).toEqual(plan)
    await deletePlan(db, 'p1')
    expect(await db.plans.count()).toBe(0)
  })
})

describe('benchmark prices', () => {
  it('goes on a recorded day only and survives the day being recorded again', async () => {
    expect(await recordBenchmark(db, '2026-10-26', 'SPY', '580.1')).toBe(false)
    await recordDailyValue(db, { date: '2026-10-26', valueBase: '100', netInvestedBase: '90' })
    expect(await recordBenchmark(db, '2026-10-26', 'SPY', '580.1')).toBe(true)
    await recordDailyValue(db, { date: '2026-10-26', valueBase: '101', netInvestedBase: '90' })
    expect(await db.dailyValues.get('2026-10-26')).toMatchObject({ valueBase: '101', benchmarkSymbol: 'SPY', benchmarkPrice: '580.1' })
  })
})
