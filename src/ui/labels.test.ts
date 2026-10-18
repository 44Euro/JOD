import { describe, expect, it } from 'vitest'
import type { Instrument } from '../domain/types'
import { ASSET_TYPE_LABELS, MARKET_LABELS, marketOf, unitLabel } from './labels'

const instrument = (overrides: Partial<Instrument>): Instrument => ({
  id: 'US:AAPL',
  market: 'US',
  symbol: 'AAPL',
  name: 'Apple',
  assetType: 'stock',
  currency: 'USD',
  ...overrides,
})

describe('marketOf', () => {
  it('reads the market from the id, including the Thai markets', () => {
    expect(marketOf('BOND:CPALL26NA')).toBe('BOND')
    expect(marketOf('FUND:SCBS&P500')).toBe('FUND')
    expect(marketOf('GOLD:96.5')).toBe('GOLD')
  })

  it('files an unknown prefix under other', () => {
    expect(marketOf('XX:ABC')).toBe('OTHER')
    expect(marketOf('ABC')).toBe('OTHER')
  })
})

describe('names of markets and asset types', () => {
  it('names the Thai markets and asset types in Thai', () => {
    expect(MARKET_LABELS.FUND).toBe('กองทุนรวม (FUND)')
    expect(MARKET_LABELS.BOND).toBe('หุ้นกู้/พันธบัตร (BOND)')
    expect(MARKET_LABELS.GOLD).toBe('ทองคำ (GOLD)')
    expect(ASSET_TYPE_LABELS).toMatchObject({
      dr: 'DR',
      fund: 'กองทุนรวม',
      bond: 'หุ้นกู้/พันธบัตร',
      gold: 'ทองคำ',
    })
  })
})

describe('unitLabel', () => {
  it('uses the unit chosen for the instrument', () => {
    const gold = instrument({ id: 'GOLD:96.5', market: 'GOLD', symbol: '96.5', name: 'ทอง 96.5%', assetType: 'gold', currency: 'THB' })
    expect(unitLabel({ ...gold, unit: 'gram' })).toBe('กรัม')
    expect(unitLabel({ ...gold, unit: 'baht_gold' })).toBe('บาททองคำ')
  })

  it('falls back to the unit that goes with the asset type', () => {
    expect(unitLabel(instrument({ assetType: 'stock' }))).toBe('หุ้น')
    expect(unitLabel(instrument({ assetType: 'dr' }))).toBe('หุ้น')
    expect(unitLabel(instrument({ assetType: 'etf' }))).toBe('หน่วย')
    expect(unitLabel(instrument({ assetType: 'fund' }))).toBe('หน่วย')
    expect(unitLabel(instrument({ assetType: 'crypto' }))).toBe('เหรียญ')
    expect(unitLabel(instrument({ assetType: 'gold' }))).toBe('บาททองคำ')
  })

  it('says units for an asset that has no record', () => {
    expect(unitLabel(undefined)).toBe('หน่วย')
  })
})
