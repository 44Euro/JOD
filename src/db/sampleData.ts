import type { Account, FeeTemplate, Instrument, Transaction, TradeJournal } from '../domain/types'
import type { JodDB } from './db'

export const SAMPLE_PREFIX = 'sample-'

export function hasSampleData(accounts: readonly Pick<Account, 'id'>[]): boolean {
  return accounts.some((account) => account.id.startsWith(SAMPLE_PREFIX))
}

function daysBefore(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

const fee = (currency: string, commissionPct: string, minimum: string, vatPct: string): FeeTemplate => ({
  currency,
  commissionPct,
  minimum,
  vatPct,
  perOrder: '0',
})

interface Line {
  daysAgo: number
  account: string
  type: Transaction['type']
  currency: string
  fxRate: string
  instrumentId?: string
  quantity?: string
  price?: string
  amount?: string
  fees?: string
  tax?: string
  toCurrency?: string
  toAmount?: string
  marketRate?: string
  journal?: TradeJournal
}

// A year of a typical Thai investor: US shares bought with baht changed at a bank, Thai shares, a little crypto and two
// finished trades, so every page has something to show.
const LINES: Line[] = [
  { daysAgo: 340, account: 'dime', type: 'deposit', currency: 'THB', fxRate: '1', amount: '350000' },
  { daysAgo: 339, account: 'dime', type: 'fx_convert', currency: 'THB', fxRate: '1', amount: '300000', toCurrency: 'USD', toAmount: '8850', marketRate: '33.70' },
  { daysAgo: 330, account: 'dime', type: 'buy', currency: 'USD', fxRate: '33.90', instrumentId: 'US:VOO', quantity: '5', price: '480' },
  { daysAgo: 300, account: 'dime', type: 'buy', currency: 'USD', fxRate: '33.90', instrumentId: 'US:AAPL', quantity: '10', price: '190' },
  { daysAgo: 320, account: 'streaming', type: 'deposit', currency: 'THB', fxRate: '1', amount: '150000' },
  { daysAgo: 310, account: 'streaming', type: 'buy', currency: 'THB', fxRate: '1', instrumentId: 'SET:PTT', quantity: '1000', price: '34.25', fees: '57.53' },
  { daysAgo: 250, account: 'streaming', type: 'buy', currency: 'THB', fxRate: '1', instrumentId: 'SET:KBANK', quantity: '300', price: '140', fees: '70.56' },
  { daysAgo: 290, account: 'bitkub', type: 'deposit', currency: 'THB', fxRate: '1', amount: '60000' },
  { daysAgo: 280, account: 'bitkub', type: 'buy', currency: 'THB', fxRate: '1', instrumentId: 'CRYPTO:BTC', quantity: '0.012', price: '2100000', fees: '63' },
  {
    daysAgo: 210,
    account: 'dime',
    type: 'buy',
    currency: 'USD',
    fxRate: '34.20',
    instrumentId: 'US:NVDA',
    quantity: '20',
    price: '110',
    journal: { strategy: 'Breakout', emotion: 'calm', confidence: 4, stopLoss: '100', target: '140' },
  },
  { daysAgo: 180, account: 'bitkub', type: 'buy', currency: 'THB', fxRate: '1', instrumentId: 'CRYPTO:ETH', quantity: '0.3', price: '95000', fees: '71.25' },
  {
    daysAgo: 160,
    account: 'dime',
    type: 'sell',
    currency: 'USD',
    fxRate: '33.60',
    instrumentId: 'US:NVDA',
    quantity: '20',
    price: '135',
    journal: { review: 'ถึงเป้าก่อนกำหนด ขายตามแผน', score: 4 },
  },
  {
    daysAgo: 120,
    account: 'dime',
    type: 'buy',
    currency: 'USD',
    fxRate: '33.10',
    instrumentId: 'US:TSLA',
    quantity: '5',
    price: '260',
    journal: { strategy: 'Earnings play', emotion: 'fomo', confidence: 2 },
  },
  {
    daysAgo: 100,
    account: 'dime',
    type: 'sell',
    currency: 'USD',
    fxRate: '33.40',
    instrumentId: 'US:TSLA',
    quantity: '5',
    price: '230',
    journal: { review: 'ซื้อตามข่าว ไม่ได้ตั้ง Stop loss', mistakes: ['chased', 'no_stop'], score: 2 },
  },
  { daysAgo: 90, account: 'streaming', type: 'dividend', currency: 'THB', fxRate: '1', instrumentId: 'SET:PTT', amount: '1400', tax: '140' },
  { daysAgo: 60, account: 'dime', type: 'dividend', currency: 'USD', fxRate: '33.50', instrumentId: 'US:VOO', amount: '9.50', tax: '1.43' },
]

const INSTRUMENTS: Omit<Instrument, 'lastPriceAt'>[] = [
  { id: 'US:VOO', market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', assetType: 'etf', currency: 'USD', lastPrice: '540' },
  { id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD', lastPrice: '230' },
  { id: 'US:NVDA', market: 'US', symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', currency: 'USD', lastPrice: '140' },
  { id: 'US:TSLA', market: 'US', symbol: 'TSLA', name: 'Tesla', assetType: 'stock', currency: 'USD', lastPrice: '250' },
  { id: 'SET:PTT', market: 'SET', symbol: 'PTT', name: 'ปตท.', assetType: 'stock', currency: 'THB', lastPrice: '33.50' },
  { id: 'SET:KBANK', market: 'SET', symbol: 'KBANK', name: 'ธนาคารกสิกรไทย', assetType: 'stock', currency: 'THB', lastPrice: '152' },
  { id: 'CRYPTO:BTC', market: 'CRYPTO', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', currency: 'THB', lastPrice: '3650000' },
  { id: 'CRYPTO:ETH', market: 'CRYPTO', symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', currency: 'THB', lastPrice: '128000' },
]

export const SAMPLE_INSTRUMENT_IDS: readonly string[] = INSTRUMENTS.map((i) => i.id)

export function sampleData(today: string): { accounts: Account[]; instruments: Instrument[]; transactions: Transaction[] } {
  const created = `${daysBefore(today, 340)}T00:00:00.000Z`
  const accounts: Account[] = [
    { id: `${SAMPLE_PREFIX}dime`, name: 'Dime US', broker: 'Dime', note: '', feeTemplate: fee('USD', '0', '0', '0'), createdAt: created },
    { id: `${SAMPLE_PREFIX}streaming`, name: 'Streaming SET', broker: 'Streaming', note: '', feeTemplate: fee('THB', '0.157', '50', '7'), createdAt: created },
    { id: `${SAMPLE_PREFIX}bitkub`, name: 'Bitkub', broker: 'Bitkub', note: '', feeTemplate: fee('THB', '0.25', '0', '0'), createdAt: created },
  ]
  const transactions = LINES.map((line, index): Transaction => {
    const date = daysBefore(today, line.daysAgo)
    const stamp = `${date}T09:${String(index).padStart(2, '0')}:00.000Z`
    return {
      id: `${SAMPLE_PREFIX}${index + 1}`,
      accountId: `${SAMPLE_PREFIX}${line.account}`,
      type: line.type,
      date,
      instrumentId: line.instrumentId,
      quantity: line.quantity,
      price: line.price,
      amount: line.amount,
      currency: line.currency,
      fees: line.fees ?? '0',
      tax: line.tax ?? '0',
      toCurrency: line.toCurrency,
      toAmount: line.toAmount,
      marketRate: line.marketRate,
      fxRate: line.fxRate,
      fxSource: line.currency === 'THB' ? 'same' : 'manual',
      journal: line.journal,
      note: '',
      createdAt: stamp,
      updatedAt: stamp,
    }
  })
  return { accounts, instruments: INSTRUMENTS.map((i) => ({ ...i, lastPriceAt: today })), transactions }
}

// An instrument the user already has keeps its own price and notes.
export async function loadSampleData(db: JodDB, today: string): Promise<void> {
  const { accounts, instruments, transactions } = sampleData(today)
  await db.transaction('rw', db.accounts, db.instruments, db.transactions, async () => {
    await db.accounts.bulkPut(accounts)
    const existing = new Set((await db.instruments.bulkGet(instruments.map((i) => i.id))).flatMap((i) => (i ? [i.id] : [])))
    await db.instruments.bulkAdd(instruments.filter((i) => !existing.has(i.id)))
    await db.transactions.bulkPut(transactions)
  })
}
