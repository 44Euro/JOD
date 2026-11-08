import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { askConfirm } from './confirm'

describe('askConfirm', () => {
  it('asks in the app, starts on cancel and answers with the button pressed', async () => {
    const user = userEvent.setup()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const answer = askConfirm({ message: 'ลบบัญชีและข้อมูลทั้งหมด?', action: 'ลบบัญชี', danger: true })
    const dialog = await screen.findByRole('alertdialog', { name: 'ลบบัญชีและข้อมูลทั้งหมด?' })
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'ลบบัญชี' }))
    expect(await answer).toBe(true)
    expect(dialog).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('answers no on cancel and on Escape', async () => {
    const user = userEvent.setup()
    const first = askConfirm({ message: 'สร้างรหัสใหม่?', action: 'สร้างรหัสใหม่' })
    await user.click(await screen.findByRole('button', { name: 'ยกเลิก' }))
    expect(await first).toBe(false)
    const second = askConfirm({ message: 'สร้างรหัสใหม่?', action: 'สร้างรหัสใหม่' })
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')
    expect(await second).toBe(false)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})

