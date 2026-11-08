import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineBar } from './OfflineBar'

afterEach(() => vi.restoreAllMocks())

describe('OfflineBar', () => {
  it('says the records stay on the device while the connection is gone, and leaves when it is back', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<OfflineBar />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    online.mockReturnValue(false)
    act(() => void window.dispatchEvent(new Event('offline')))
    expect(screen.getByRole('status')).toHaveTextContent('ออฟไลน์ · บันทึกได้ตามปกติ ข้อมูลจะซิงก์เมื่อกลับมาออนไลน์')
    online.mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event('online')))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
