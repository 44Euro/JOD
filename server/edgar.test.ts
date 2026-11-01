// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { compareHoldings, nameIndex, parseForm4, parseInfoTable, tickerOf } from './edgar.ts'

const row = (issuer: string, cusip: string, value: number, shares: number, putCall = '', ns = '') =>
  `<${ns}infoTable><${ns}nameOfIssuer>${issuer}</${ns}nameOfIssuer><${ns}titleOfClass>COM</${ns}titleOfClass><${ns}cusip>${cusip}</${ns}cusip><${ns}value>${value}</${ns}value><${ns}shrsOrPrnAmt><${ns}sshPrnamt>${shares}</${ns}sshPrnamt><${ns}sshPrnamtType>SH</${ns}sshPrnamtType></${ns}shrsOrPrnAmt>${putCall ? `<${ns}putCall>${putCall}</${ns}putCall>` : ''}<${ns}investmentDiscretion>DFND</${ns}investmentDiscretion></${ns}infoTable>`

describe('13F information table', () => {
  it('adds up the rows of one security and leaves options out', () => {
    const xml = `<informationTable>${row('APPLE INC', '037833100', 60000000000, 300000000)}${row('APPLE INC', '037833100', 2000000000, 10000000)}${row('APPLE INC', '037833100', 100, 1, 'Put')}${row('BANK AMER CORP', '060505104', 30000000000, 700000000)}</informationTable>`
    expect(parseInfoTable(xml)).toEqual([
      { cusip: '037833100', issuer: 'APPLE INC', shares: 310000000, value: 62000000000 },
      { cusip: '060505104', issuer: 'BANK AMER CORP', shares: 700000000, value: 30000000000 },
    ])
  })

  it('reads a table whose tags carry a namespace prefix', () => {
    const xml = `<ns1:informationTable>${row('CHEVRON CORP NEW', '166764100', 18000000000, 120000000, '', 'ns1:')}</ns1:informationTable>`
    expect(parseInfoTable(xml)).toEqual([{ cusip: '166764100', issuer: 'CHEVRON CORP NEW', shares: 120000000, value: 18000000000 }])
  })

  it('compares two quarters position by position', () => {
    const holding = (cusip: string, shares: number, value: number) => ({ cusip, issuer: cusip, shares, value })
    const moves = compareHoldings([holding('A', 10, 100), holding('B', 5, 50), holding('C', 8, 80), holding('E', 3, 30)], [holding('B', 8, 70), holding('C', 2, 20), holding('D', 4, 40), holding('E', 3, 25)])
    expect(moves.map((m) => [m.cusip, m.change, m.sharesChange, m.valueChange])).toEqual([
      ['A', 'new', 10, 100],
      ['B', 'reduce', -3, -20],
      ['C', 'add', 6, 60],
      ['E', 'same', 0, 5],
      ['D', 'exit', -4, -40],
    ])
  })
})

describe('Form 4', () => {
  const transaction = (code: string, shares: number, price: number, date: string) =>
    `<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>${date}</value></transactionDate><transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${code === 'S' ? 'D' : 'A'}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>`
  const form = (relationship: string, transactions: string) =>
    `<ownershipDocument><issuer><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer><reportingOwner><reportingOwnerId><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId><reportingOwnerRelationship>${relationship}</reportingOwnerRelationship></reportingOwner><nonDerivativeTable>${transactions}</nonDerivativeTable></ownershipDocument>`

  it('keeps open-market buys and sells with who made them', () => {
    const xml = form(
      '<isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle>',
      transaction('S', 129963, 256.81, '2025-10-02') + transaction('A', 50000, 0, '2025-10-01') + transaction('P', 1000, 250.5, '2025-10-03'),
    )
    expect(parseForm4(xml)).toEqual([
      { owner: 'COOK TIMOTHY D', role: 'Chief Executive Officer', date: '2025-10-02', side: 'sell', shares: '129963', price: '256.81' },
      { owner: 'COOK TIMOTHY D', role: 'Chief Executive Officer', date: '2025-10-03', side: 'buy', shares: '1000', price: '250.5' },
    ])
  })

  it('names a director or a large owner without an officer title', () => {
    expect(parseForm4(form('<isDirector>1</isDirector>', transaction('P', 10, 5, '2025-10-03')))[0].role).toBe('Director')
    expect(parseForm4(form('<isTenPercentOwner>true</isTenPercentOwner>', transaction('P', 10, 5, '2025-10-03')))[0].role).toBe('10% owner')
  })
})

describe('issuer names to tickers', () => {
  const index = nameIndex({
    '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
    '1': { cik_str: 1652044, ticker: 'GOOGL', title: 'Alphabet Inc.' },
    '2': { cik_str: 1652044, ticker: 'GOOG', title: 'Alphabet Inc.' },
    '3': { cik_str: 1059556, ticker: 'MCO', title: 'MOODYS CORP /DE/' },
    '4': { cik_str: 21344, ticker: 'KO', title: 'COCA-COLA CO' },
  })

  it('matches 13F issuer names to SEC company titles', () => {
    expect([tickerOf(index, 'APPLE INC'), tickerOf(index, 'ALPHABET INC'), tickerOf(index, 'MOODYS CORP'), tickerOf(index, 'COCA COLA CO')]).toEqual(['AAPL', 'GOOGL', 'MCO', 'KO'])
  })

  it('leaves an abbreviated name unmatched', () => {
    expect(tickerOf(index, 'BANK AMER CORP')).toBeNull()
  })
})
