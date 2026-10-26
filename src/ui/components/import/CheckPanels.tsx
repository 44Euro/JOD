import { useMemo, useState } from 'react'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { db } from '../../../db/db'
import { setInstrumentPrice } from '../../../db/repo'
import { parseDecimalInput } from '../../../domain/decimal'
import { computeLedger } from '../../../domain/ledger'
import type { Instrument, Transaction } from '../../../domain/types'
import { cn } from '../../../lib/cn'
import { fmtNumber, fmtPrice } from '../../format'
import { compareHoldings, priceUpdates, type CompareState, type ReviewRow } from '../../importReview'
import { t } from '../../../i18n'

export function PriceReviewPanel({
  rows,
  instruments,
  onDone,
  onCancel,
}: {
  rows: readonly ReviewRow[]
  instruments: readonly Instrument[]
  onDone: (count: number) => void
  onCancel: () => void
}) {
  const { updates, unknown } = useMemo(() => priceUpdates(rows, instruments), [rows, instruments])
  const [prices, setPrices] = useState(() => Object.fromEntries(updates.map((u) => [u.key, u.price])))
  const [picked, setPicked] = useState(() => new Set(updates.map((u) => u.key)))
  const [error, setError] = useState('')
  const chosen = updates.filter((u) => picked.has(u.key))

  async function save() {
    const parsed = chosen.map((u) => ({ id: u.instrument.id, price: parseDecimalInput(prices[u.key] ?? '') }))
    if (parsed.some((p) => p.price === null || Number(p.price) <= 0)) {
      setError(t('ราคาต้องเป็นตัวเลขมากกว่า 0'))
      return
    }
    const now = new Date()
    for (const { id, price } of parsed) await setInstrumentPrice(db, id, price!, now)
    onDone(parsed.length)
  }

  return (
    <div className="grid gap-4">
      {updates.length === 0 ? (
        <p className="text-muted-foreground">{t('ไม่พบราคาของสินทรัพย์ที่มีในพอร์ต')}</p>
      ) : (
        <ul aria-label={t('ราคาที่อ่านได้')}>
          {updates.map((u) => (
            <li key={u.key} className="flex flex-wrap items-center gap-3 border-t border-muted py-3 first:border-t-0">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                aria-label={t('อัปเดต {0}', u.instrument.symbol)}
                checked={picked.has(u.key)}
                onChange={(e) =>
                  setPicked((current) => {
                    const next = new Set(current)
                    if (e.target.checked) next.add(u.key)
                    else next.delete(u.key)
                    return next
                  })
                }
              />
              <b className="min-w-16 font-display">{u.instrument.symbol}</b>
              <span className="text-[13px] text-muted-foreground">{t('เดิม ')}{fmtPrice(u.instrument.lastPrice)}</span>
              <Input
                aria-label={t('ราคาใหม่ของ {0}', u.instrument.symbol)}
                inputMode="decimal"
                className="h-10 w-32 border-warning-fg bg-warning-bg tabular-nums"
                value={prices[u.key] ?? ''}
                onChange={(e) => setPrices((c) => ({ ...c, [u.key]: e.target.value }))}
              />
              <span className="text-[13px] text-muted-foreground">{u.instrument.currency}</span>
            </li>
          ))}
        </ul>
      )}
      {unknown.length > 0 && <p className="text-[12.5px] text-muted-foreground">{t('ไม่มีในพอร์ต จึงข้ามไป: ')}{unknown.join(', ')}</p>}
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={chosen.length === 0} onClick={() => void save()}>
          {t('อัปเดตราคา ')}{chosen.length} {t(' ตัว')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('ยกเลิก')}
        </Button>
      </div>
    </div>
  )
}

const STATE_TEXT: Record<CompareState, { label: string; variant: 'ok' | 'warning' | 'default' }> = {
  match: { label: t('ตรงกัน'), variant: 'ok' },
  differ: { label: t('จำนวนไม่ตรง'), variant: 'warning' },
  not_in_app: { label: t('ไม่มีในแอป'), variant: 'warning' },
  not_on_screen: { label: t('ไม่มีในรูป'), variant: 'default' },
}

export function ComparePanel({
  rows,
  transactions,
  instruments,
  accountId,
  onDone,
}: {
  rows: readonly ReviewRow[]
  transactions: readonly Transaction[]
  instruments: readonly Instrument[]
  accountId: string
  onDone: () => void
}) {
  const lines = useMemo(
    () => compareHoldings(rows, computeLedger(transactions).positions, instruments, accountId),
    [rows, transactions, instruments, accountId],
  )
  const matched = lines.filter((l) => l.state === 'match').length
  return (
    <div className="grid gap-4">
      <p className="font-semibold">
        {t('ตรงกัน ')}{matched} {t(' จาก ')}{lines.length} {t(' ตัว')}
      </p>
      <ul aria-label={t('ผลการเทียบยอด')}>
        {lines.map((line) => (
          <li
            key={`${line.symbol}-${line.state}`}
            className={cn('grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-t border-muted py-3 first:border-t-0')}
          >
            <b className="font-display">{line.symbol}</b>
            <Badge variant={STATE_TEXT[line.state].variant} className="justify-self-end">
              {STATE_TEXT[line.state].label}
            </Badge>
            <span className="col-span-2 text-[13px] text-muted-foreground tabular-nums">
              {t('ในโบรก ')}{line.broker ? fmtNumber(line.broker, 8) : '—'} {t(' · ในแอป ')}{line.app ? fmtNumber(line.app, 8) : '—'}
              {line.state === 'differ' && line.broker && line.app && t(' · ต่าง {0}', fmtNumber(line.broker.minus(line.app), 8))}
            </span>
          </li>
        ))}
      </ul>
      {lines.some((l) => l.state === 'differ' || l.state === 'not_in_app') && (
        <p className="text-[12.5px] text-muted-foreground">{t('ตัวที่ไม่ตรงมักมาจากรายการที่ลืมจด หรือปันผลเป็นหุ้น ลองดูในหน้ารายการของบัญชีนี้')}</p>
      )}
      <div>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('เสร็จ')}
        </Button>
      </div>
    </div>
  )
}
