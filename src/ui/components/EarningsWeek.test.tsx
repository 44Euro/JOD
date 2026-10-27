import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { EarningsEvent } from '../../market/client'
import { EarningsWeek } from './EarningsWeek'

const week = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
const event = (symbol: string, date: string, time: EarningsEvent['time'] = 'after'): EarningsEvent => ({ symbol, date, time, epsEstimate: '1', epsActual: null })
const events = [event('AAPL', '2026-10-29'), event('KO', '2026-10-27', 'before'), event('MSFT', '2026-10-28'), event('ZZZ', '2026-10-28')]

function show() {
  render(
    <MemoryRouter>
      <EarningsWeek state={{ status: 'ready', data: events }} week={week} held={['AAPL', 'MSFT']} watched={['KO']} today="2026-10-27" />
    </MemoryRouter>,
  )
  return screen.getByRole('region', { name: 'ประกาศงบสัปดาห์นี้' })
}

describe('EarningsWeek', () => {
  it('puts held and watched reports under their day', () => {
    const section = show()
    expect(within(section).getByRole('listitem', { name: 'อังคาร 27 ต.ค. 2026' })).toHaveTextContent('KOก่อนเปิด')
    expect(within(section).getByRole('listitem', { name: 'พุธ 28 ต.ค. 2026' })).toHaveTextContent('MSFT')
    expect(within(section).getByRole('listitem', { name: 'พฤหัสบดี 29 ต.ค. 2026' })).toHaveTextContent('AAPLถืออยู่หลังปิด')
    expect(section).not.toHaveTextContent('ZZZ')
    expect(section).toHaveTextContent('ทั้งตลาดสัปดาห์นี้ 4 บริษัท')
    expect(within(section).getByRole('link', { name: 'ดูทั้งหมด' })).toHaveAttribute('href', '/market/earnings')
  })

  it('marks a held symbol and leaves an empty day as a dash', () => {
    const section = show()
    expect(within(section).getByText('AAPL')).toHaveClass('text-primary')
    expect(within(section).getByText('KO')).not.toHaveClass('text-primary')
    expect(within(section).getByRole('listitem', { name: 'จันทร์ 26 ต.ค. 2026' })).toHaveTextContent('—')
    expect(within(section).getByRole('listitem', { name: 'อังคาร 27 ต.ค. 2026' })).toHaveAttribute('aria-current', 'date')
  })
})
