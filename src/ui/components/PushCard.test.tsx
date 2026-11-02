import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PUSH_TOKEN_KEY } from '../../push/push'
import { PushCard } from './PushCard'

beforeEach(() => localStorage.removeItem(PUSH_TOKEN_KEY))

describe('PushCard', () => {
  it('says pushes work in the phone app when opened in a browser', () => {
    render(<PushCard alerts={[]} native={false} />)
    expect(screen.getByRole('region', { name: 'แจ้งเตือนราคาแบบ push' })).toHaveTextContent('ใช้ได้ในแอปมือถือ')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('says what the server will learn and switches on through the opt-in', async () => {
    const enable = vi.fn(async () => 'on' as const)
    const user = userEvent.setup()
    render(<PushCard alerts={[]} native enable={enable} disable={vi.fn()} />)
    const card = screen.getByRole('region', { name: 'แจ้งเตือนราคาแบบ push' })
    expect(card).toHaveTextContent('เซิร์ฟเวอร์ JOD จะรู้สัญลักษณ์และราคาของแจ้งเตือนแต่ละรายการ')
    await user.click(screen.getByRole('switch', { name: 'ส่งแจ้งเตือนราคามาที่เครื่องนี้' }))
    expect(enable).toHaveBeenCalled()
  })

  it('explains when the server has no push yet', async () => {
    const user = userEvent.setup()
    render(<PushCard alerts={[]} native enable={async () => 'server-off'} disable={vi.fn()} />)
    await user.click(screen.getByRole('switch', { name: 'ส่งแจ้งเตือนราคามาที่เครื่องนี้' }))
    expect(await screen.findByText(/เซิร์ฟเวอร์ยังไม่เปิด push/)).toBeInTheDocument()
  })

  it('switches off and forgets this phone', async () => {
    localStorage.setItem(PUSH_TOKEN_KEY, 'device-token')
    const disable = vi.fn(async () => localStorage.removeItem(PUSH_TOKEN_KEY))
    const user = userEvent.setup()
    render(<PushCard alerts={[]} native enable={vi.fn()} disable={disable} />)
    const toggle = screen.getByRole('switch', { name: 'ส่งแจ้งเตือนราคามาที่เครื่องนี้' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(disable).toHaveBeenCalled()
  })
})
