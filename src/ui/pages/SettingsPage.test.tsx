import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { getSettings } from '../../db/repo'
import { makeTx } from '../../test/fixtures'
import { API_KEY_STORAGE_KEY, AUTO_PRICES_STORAGE_KEY, FINNHUB_KEY_STORAGE_KEY, READER_MODE_STORAGE_KEY } from '../../ai/apiKey'
import { renderRoute, resetDb } from '../../test/render'

const account = { id: 'acc-1', name: 'Dime US', broker: 'Dime', note: '', createdAt: '2024-01-01T00:00:00.000Z' }

describe('SettingsPage', () => {
  beforeEach(resetDb)

  it('adds an account and lists it', async () => {
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.type(await screen.findByLabelText('ชื่อบัญชี'), 'Dime US')
    await user.type(screen.getByLabelText('โบรกเกอร์'), 'Dime')
    await user.click(screen.getByRole('button', { name: 'เพิ่มบัญชี' }))
    expect(await screen.findByText('Dime US')).toBeInTheDocument()
    expect(await db.accounts.count()).toBe(1)
  })

  it('saves at once whether to hide the numbers on launch', async () => {
    await db.accounts.add(account)
    const user = userEvent.setup()
    renderRoute('/settings')
    const toggle = await screen.findByRole('switch', { name: 'ซ่อนตัวเลขทุกครั้งที่เปิดแอป' })
    expect(screen.getByRole('heading', { name: 'ความเป็นส่วนตัว' })).toBeInTheDocument()
    expect(screen.getByText('แสดงเป็น ••• จนกว่าจะแตะรูปตา')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveClass('h-11', 'min-w-11')

    await user.click(toggle)
    expect(await screen.findByRole('switch', { name: 'ซ่อนตัวเลขทุกครั้งที่เปิดแอป', checked: true })).toHaveAttribute('aria-checked', 'true')
    expect(await getSettings(db)).toEqual({ baseCurrency: 'THB', hideNumbersOnLaunch: true })

    await user.click(screen.getByRole('switch', { name: 'ซ่อนตัวเลขทุกครั้งที่เปิดแอป' }))
    expect(await screen.findByRole('switch', { name: 'ซ่อนตัวเลขทุกครั้งที่เปิดแอป', checked: false })).toHaveAttribute('aria-checked', 'false')
    expect((await getSettings(db)).hideNumbersOnLaunch).toBe(false)
  })

  it('switches the theme and keeps the choice', async () => {
    await db.accounts.add(account)
    const user = userEvent.setup()
    renderRoute('/settings')
    const themes = await screen.findByRole('group', { name: 'ธีม' })
    expect(within(themes).getByRole('button', { name: 'ตามระบบ' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(themes).getByRole('button', { name: 'มืด' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect((await getSettings(db)).theme).toBe('dark')
    await user.click(within(themes).getByRole('button', { name: 'สว่าง' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })

  it('leaves the numbers showing for the rest of this visit when the setting is turned on', async () => {
    await db.accounts.add(account)
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('switch', { name: 'ซ่อนตัวเลขทุกครั้งที่เปิดแอป' }))
    await screen.findByRole('switch', { name: 'ซ่อนตัวเลขทุกครั้งที่เปิดแอป', checked: true })
    await user.click(within(screen.getByRole('navigation', { name: 'เมนูหลัก' })).getByRole('link', { name: 'ภาพรวม' }))
    expect(await screen.findByRole('button', { name: 'ซ่อนตัวเลข' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('locks the base currency once transactions exist', async () => {
    await db.accounts.add(account)
    await db.transactions.add(makeTx())
    renderRoute('/settings')
    expect(await screen.findByLabelText('สกุลเงินหลัก')).toBeDisabled()
    expect(screen.getByText(/เปลี่ยนไม่ได้หลังมีรายการแล้ว/)).toBeInTheDocument()
  })

  it('explains why an account with transactions cannot be deleted', async () => {
    await db.accounts.add(account)
    await db.transactions.add(makeTx())
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'ลบ Dime US' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ลบไม่ได้ บัญชีนี้ยังมี 1 รายการ')
    expect(await db.accounts.count()).toBe(1)
  })

  describe('account fee formula', () => {
    const streaming = { id: 'acc-2', name: 'Streaming SET', broker: 'Streaming', note: '', createdAt: '2024-01-02T00:00:00.000Z' }
    const formula = { currency: 'THB', commissionPct: '0.157', minimum: '50', vatPct: '7', perOrder: '' }
    const editorOf = (name: string) => within(screen.getByRole('form', { name: `แก้ไข ${name}` }))

    it('edits an account formula and shows its summary under the name', async () => {
      await db.accounts.add(streaming)
      const user = userEvent.setup()
      renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' }))
      const editor = editorOf('Streaming SET')
      await user.click(editor.getByLabelText('บัญชีนี้มีค่าคอมซื้อขาย'))
      await user.selectOptions(editor.getByLabelText('สกุลของสูตร'), 'THB')
      await user.type(editor.getByLabelText('ค่าคอม (%)'), '0.157')
      await user.type(editor.getByLabelText('ขั้นต่ำต่อคำสั่ง'), '50')
      await user.type(editor.getByLabelText('VAT (%)'), '7')
      await user.click(editor.getByRole('button', { name: 'บันทึก' }))
      const summary = await screen.findByText(/^THB · 0\.157% \+ VAT 7%/)
      expect(summary).toHaveTextContent('THB · 0.157% + VAT 7% · ขั้นต่ำ 50 บาท')
      expect(within(summary).getByText('· ขั้นต่ำ 50 บาท')).toHaveClass('whitespace-nowrap')
      expect(summary.textContent).toContain('+\u00a0VAT\u00a07%')
      expect(screen.queryByRole('form', { name: 'แก้ไข Streaming SET' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'แก้ไข Streaming SET' })).toBeInTheDocument()
      expect((await db.accounts.get('acc-2'))?.feeTemplate).toEqual({
        currency: 'THB',
        commissionPct: '0.157',
        minimum: '50',
        vatPct: '7',
        perOrder: '',
      })
    })

    it('shows the broker under the name of an account without a formula', async () => {
      await db.accounts.bulkAdd([streaming, { ...account, feeTemplate: formula }])
      renderRoute('/settings')
      expect(await screen.findByText('Streaming')).toBeInTheDocument()
      expect(screen.getByText(/^THB · 0\.157% \+ VAT 7%/)).toHaveTextContent('THB · 0.157% + VAT 7% · ขั้นต่ำ 50 บาท')
      expect(screen.queryByText('Dime')).not.toBeInTheDocument()
    })

    it('opens with what is stored, and takes the formula away when it is unticked', async () => {
      await db.accounts.add({ ...streaming, feeTemplate: formula })
      const user = userEvent.setup()
      renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' }))
      const editor = editorOf('Streaming SET')
      expect(editor.getByLabelText('ชื่อบัญชี')).toHaveValue('Streaming SET')
      expect(editor.getByLabelText('โบรกเกอร์')).toHaveValue('Streaming')
      expect(editor.getByLabelText('บัญชีนี้มีค่าคอมซื้อขาย')).toBeChecked()
      expect(editor.getByLabelText('ค่าคอม (%)')).toHaveValue('0.157')
      expect(editor.getByLabelText('ขั้นต่ำต่อคำสั่ง')).toHaveValue('50')
      expect(editor.getByLabelText('VAT (%)')).toHaveValue('7')
      expect(editor.getByLabelText('ค่าธรรมเนียมต่อคำสั่ง')).toHaveValue('')
      await user.click(editor.getByLabelText('บัญชีนี้มีค่าคอมซื้อขาย'))
      expect(editor.queryByLabelText('ค่าคอม (%)')).not.toBeInTheDocument()
      await user.click(editor.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('Streaming')).toBeInTheDocument()
      expect(await db.accounts.get('acc-2')).not.toHaveProperty('feeTemplate')
    })

    it('renames an account and keeps it listed in place of its editor', async () => {
      await db.accounts.add(streaming)
      const user = userEvent.setup()
      renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' }))
      const editor = editorOf('Streaming SET')
      await user.clear(editor.getByLabelText('ชื่อบัญชี'))
      await user.type(editor.getByLabelText('ชื่อบัญชี'), 'Streaming ใหม่')
      await user.clear(editor.getByLabelText('โบรกเกอร์'))
      await user.click(editor.getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('Streaming ใหม่')).toBeInTheDocument()
      expect(await db.accounts.get('acc-2')).toMatchObject({ name: 'Streaming ใหม่', broker: '' })
    })

    it('says what is wrong under the form and keeps it open', async () => {
      await db.accounts.add(streaming)
      const user = userEvent.setup()
      renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' }))
      const editor = editorOf('Streaming SET')
      await user.click(editor.getByLabelText('บัญชีนี้มีค่าคอมซื้อขาย'))
      await user.type(editor.getByLabelText('ค่าคอม (%)'), '-1')
      await user.click(editor.getByRole('button', { name: 'บันทึก' }))
      expect(await editor.findByRole('alert')).toHaveTextContent('ค่าคอมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
      expect(await db.accounts.get('acc-2')).not.toHaveProperty('feeTemplate')
      await user.clear(editor.getByLabelText('ชื่อบัญชี'))
      await user.click(editor.getByRole('button', { name: 'บันทึก' }))
      expect(await editor.findByRole('alert')).toHaveTextContent('กรุณาตั้งชื่อบัญชี')
    })

    it('closes the editor without saving when cancelled', async () => {
      await db.accounts.add(streaming)
      const user = userEvent.setup()
      renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' }))
      await user.type(editorOf('Streaming SET').getByLabelText('ชื่อบัญชี'), ' X')
      await user.click(editorOf('Streaming SET').getByRole('button', { name: 'ยกเลิก' }))
      expect(screen.queryByRole('form', { name: 'แก้ไข Streaming SET' })).not.toBeInTheDocument()
      expect(screen.getByText('Streaming SET')).toBeInTheDocument()
      expect((await db.accounts.get('acc-2'))?.name).toBe('Streaming SET')
    })

    it('keeps the summary of a formula without a minimum as plain text', async () => {
      await db.accounts.add({ ...streaming, feeTemplate: { currency: 'THB', commissionPct: '0.25', minimum: '', vatPct: '', perOrder: '5' } })
      renderRoute('/settings')
      expect(await screen.findByText('THB · 0.25% + 5 ต่อคำสั่ง')).toBeInTheDocument()
    })

    it('puts the focus in the name field when the editor opens', async () => {
      await db.accounts.add(streaming)
      const user = userEvent.setup()
      renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' }))
      expect(editorOf('Streaming SET').getByLabelText('ชื่อบัญชี')).toHaveFocus()
    })

    it('gives the focus back to the edit button of the row when the editor closes', async () => {
      await db.accounts.bulkAdd([account, streaming])
      const user = userEvent.setup()
      renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' }))
      await user.click(editorOf('Streaming SET').getByRole('button', { name: 'ยกเลิก' }))
      expect(screen.getByRole('button', { name: 'แก้ไข Streaming SET' })).toHaveFocus()

      await user.click(screen.getByRole('button', { name: 'แก้ไข Dime US' }))
      await user.type(editorOf('Dime US').getByLabelText('โบรกเกอร์'), ' US')
      await user.click(editorOf('Dime US').getByRole('button', { name: 'บันทึก' }))
      expect(await screen.findByText('Dime US')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'แก้ไข Dime US' })).toHaveFocus()
    })

    it('gives the edit button a phone-sized target', async () => {
      await db.accounts.add(streaming)
      renderRoute('/settings')
      expect(await screen.findByRole('button', { name: 'แก้ไข Streaming SET' })).toHaveClass('size-11', 'md:size-10')
    })
  })

  it('reads files on the device for free unless another provider is chosen', async () => {
    localStorage.removeItem(READER_MODE_STORAGE_KEY)
    const user = userEvent.setup()
    renderRoute('/settings')
    const picker = await screen.findByLabelText('ใช้อ่านด้วย')
    expect(picker).toHaveValue('local')
    expect(screen.getByText(/ไม่มีค่าใช้จ่าย ไฟล์ไม่ออกจากเครื่อง/)).toBeInTheDocument()
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    await user.selectOptions(picker, 'claude')
    expect(localStorage.getItem(READER_MODE_STORAGE_KEY)).toBe('claude')
    expect(screen.getByLabelText('API key')).toBeInTheDocument()
    await user.selectOptions(picker, 'local')
    expect(localStorage.getItem(READER_MODE_STORAGE_KEY)).toBeNull()
  })

  it('keeps the address, model and key of a compatible service on this device', async () => {
    localStorage.setItem(READER_MODE_STORAGE_KEY, 'compatible')
    localStorage.removeItem('jod-ai-compatible')
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.type(await screen.findByLabelText('ที่อยู่ API'), 'http://localhost:11434/v1')
    await user.type(screen.getByLabelText('ชื่อรุ่น'), 'llava')
    await user.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า AI' }))
    expect(JSON.parse(localStorage.getItem('jod-ai-compatible')!)).toMatchObject({ baseUrl: 'http://localhost:11434/v1', model: 'llava' })
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('11434')
  })

  it('keeps the AI key on this device only, masks it and tests it', async () => {
    localStorage.removeItem(API_KEY_STORAGE_KEY)
    localStorage.setItem(READER_MODE_STORAGE_KEY, 'claude')
    const tested: string[] = []
    const user = userEvent.setup()
    renderRoute('/settings', undefined, {
      read: () => Promise.reject(new Error('unused')),
      test: async () => {
        tested.push('called')
      },
    })
    await user.type(await screen.findByLabelText('API key'), 'sk-ant-api03-abcdefghijkl1234')
    await user.click(screen.getByRole('button', { name: 'บันทึก key' }))
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBe('sk-ant-api03-abcdefghijkl1234')
    expect(screen.getByText(/sk-ant-…1234/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ทดสอบการเชื่อมต่อ' }))
    expect(await screen.findByText('เชื่อมต่อได้ พร้อมให้ AI อ่านรูป')).toBeInTheDocument()
    expect(tested).toEqual(['called'])
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('sk-ant')
    await user.click(screen.getByRole('button', { name: 'ลบ key' }))
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull()
    expect(screen.queryByText(/sk-ant-…1234/)).not.toBeInTheDocument()
  })

  it('keeps price source keys on this device and saves the benchmark', async () => {
    localStorage.removeItem(FINNHUB_KEY_STORAGE_KEY)
    localStorage.removeItem(AUTO_PRICES_STORAGE_KEY)
    const user = userEvent.setup()
    renderRoute('/settings')
    await user.type(await screen.findByLabelText('Finnhub API key'), 'abcdefghijklmnop')
    await user.click(within(screen.getByLabelText('Finnhub API key').closest('form')!).getByRole('button', { name: 'บันทึก' }))
    expect(localStorage.getItem(FINNHUB_KEY_STORAGE_KEY)).toBe('abcdefghijklmnop')
    await user.click(screen.getByRole('switch', { name: 'ดึงราคาวันละครั้งเมื่อเปิดแอป' }))
    expect(localStorage.getItem(AUTO_PRICES_STORAGE_KEY)).toBe('on')
    const benchmark = screen.getByLabelText('ดัชนีที่ใช้เทียบผลตอบแทน')
    await user.clear(benchmark)
    await user.type(benchmark, 'qqq')
    expect(benchmark).toHaveValue('QQQ')
    await user.tab()
    expect(benchmark).not.toHaveFocus()
    await waitFor(async () => expect((await getSettings(db)).benchmarkSymbol).toBe('QQQ'))
  })
})
