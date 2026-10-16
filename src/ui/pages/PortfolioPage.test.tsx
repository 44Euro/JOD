import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { fakeFxProvider } from '../../test/fakeFx'
import { makeTx } from '../../test/fixtures'
import { renderRoute, resetDb } from '../../test/render'

beforeEach(async () => {
  await resetDb()
  await db.accounts.add({ id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' })
})

describe('PortfolioPage', () => {
  it('values a holding from the typed price and splits the gain into stock and currency', async () => {
    await db.instruments.add({ id: 'US:AAPL', market: 'US', symbol: 'AAPL', name: 'Apple', assetType: 'stock', currency: 'USD' })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    const user = userEvent.setup()
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    await user.type(await screen.findByLabelText('ราคาล่าสุด AAPL'), '120')
    await user.tab()
    const row = (await screen.findByText('Apple')).closest('tr')!
    expect(await within(row).findByText('+4,600.00')).toBeInTheDocument()
    expect(within(row).getByText('+7,000.00')).toBeInTheDocument()
    expect(within(row).getByText('−2,400.00')).toBeInTheDocument()
    expect((await db.instruments.get('US:AAPL'))?.lastPrice).toBe('120')
  })

  it('flags a price that has not been updated for more than 7 days', async () => {
    await db.instruments.add({
      id: 'US:AAPL',
      market: 'US',
      symbol: 'AAPL',
      name: 'Apple',
      assetType: 'stock',
      currency: 'USD',
      lastPrice: '120',
      lastPriceAt: '2020-01-01T00:00:00.000Z',
    })
    await db.transactions.add(makeTx({ quantity: '10', price: '100', fxRate: '35' }))
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText(/วันก่อน$/)).toBeInTheDocument()
  })

  it('shows cash left in each account with its value in baht', async () => {
    await db.transactions.add(
      makeTx({ type: 'deposit', instrumentId: undefined, quantity: undefined, price: undefined, amount: '1000', fxRate: '35' }),
    )
    renderRoute('/portfolio', fakeFxProvider({ 'USD|THB': '33' }).provider)
    expect(await screen.findByText('1,000.00 USD')).toBeInTheDocument()
    expect(await screen.findByText('33,000')).toBeInTheDocument()
  })
})
