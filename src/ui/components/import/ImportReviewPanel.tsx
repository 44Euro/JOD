import { Check, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Extraction } from '../../../ai/extraction'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { db } from '../../../db/db'
import { newId, saveImport, setInstrumentPrice } from '../../../db/repo'
import { todayLocal } from '../../../domain/dates'
import { quoteWithPegFallback } from '../../../fx/fxService'
import { useFxProvider } from '../../../fx/context'
import { fmtNumber, fmtRate } from '../../format'
import {
  buildImport,
  checkTotal,
  patchRow,
  rowProblems,
  type OpeningRate,
  type ReviewContext,
  type ReviewRow,
} from '../../importReview'
import { ReviewRowEditor } from './ReviewRowEditor'

function rateKey(row: ReviewRow): string {
  return `${row.currency}|${row.date}`
}

export function ImportReviewPanel({
  extraction,
  ctx,
  fileCount,
  initialRows,
  onSaved,
  onCancel,
}: {
  extraction: Extraction
  ctx: ReviewContext
  fileCount: number
  initialRows: ReviewRow[]
  onSaved: (count: number) => void
  onCancel: () => void
}) {
  const provider = useFxProvider()
  const today = todayLocal()
  const [rows, setRows] = useState(initialRows)
  const [openingDate, setOpeningDate] = useState(today)
  const [openingRates, setOpeningRates] = useState<Record<string, OpeningRate>>({})
  const [references, setReferences] = useState<Record<string, string>>({})
  const [updatePrices, setUpdatePrices] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const tried = useRef(new Set<string>())
  const base = ctx.baseCurrency

  // Orders take the reference rate of their own day, as the form does; a rate that cannot be fetched is left for the
  // user to type, and is not asked for again.
  useEffect(() => {
    const wanted = rows.filter((r) => r.kind !== 'opening' && r.currency !== base && r.date && r.fxSource === 'auto' && !r.fxRate)
    for (const row of wanted) {
      const key = rateKey(row)
      if (tried.current.has(key)) continue
      tried.current.add(key)
      quoteWithPegFallback(db, provider, row.currency, base, row.date)
        .then(({ quote, borrowed }) =>
          setRows((current) =>
            current.map((r) =>
              rateKey(r) === key && r.fxSource === 'auto' && !r.fxRate ? { ...r, fxRate: quote.rate, fxSource: borrowed ? 'estimated' : 'auto' } : r,
            ),
          ),
        )
        .catch(() => {})
    }
  }, [rows, base, provider])

  const openingCurrencies = useMemo(
    () => [...new Set(rows.filter((r) => r.include && r.kind === 'opening' && r.currency !== base).map((r) => r.currency))],
    [rows, base],
  )
  const openingKey = openingCurrencies.join(',')

  useEffect(() => {
    for (const currency of openingKey ? openingKey.split(',') : []) {
      quoteWithPegFallback(db, provider, currency, base, openingDate)
        .then(({ quote }) => setReferences((current) => ({ ...current, [`${currency}|${openingDate}`]: quote.rate })))
        .catch(() => {})
    }
  }, [openingKey, openingDate, base, provider])

  const chosen = rows.filter((r) => r.include)
  const toCheck = chosen.reduce((sum, r) => sum + r.uncertain.length, 0)
  const total = checkTotal(rows, extraction)
  const hasPrices = chosen.some((r) => r.kind === 'opening' && r.lastPrice)

  async function confirm() {
    setErrors([])
    const batchId = newId()
    const now = new Date()
    const built = buildImport(rows, { ...ctx, batchId, openingDate, openingRates, now, newId })
    if (built.errors.length > 0) {
      setErrors(built.errors)
      return
    }
    setSaving(true)
    try {
      await saveImport(
        db,
        {
          id: batchId,
          accountId: ctx.accountId,
          source: extraction.source,
          fileCount,
          count: built.transactions.length,
          createdInstrumentIds: built.instruments.map((i) => i.id),
          createdAt: now.toISOString(),
        },
        built.transactions,
        built.instruments,
        now,
      )
      if (updatePrices && hasPrices) for (const { id, price } of built.prices) await setInstrumentPrice(db, id, price, now)
      onSaved(built.transactions.length)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {total.state === 'match' && (
          <Badge variant="ok">
            <Check aria-hidden />
            ยอดรวมตรงกับรูป {fmtNumber(total.stated)} {total.currency}
          </Badge>
        )}
        {total.state === 'mismatch' && (
          <Badge variant="warning">
            <TriangleAlert aria-hidden />
            ยอดรวมไม่ตรง: ในรูป {fmtNumber(total.stated)} · แอปบวกได้ {fmtNumber(total.counted)} {total.currency}
          </Badge>
        )}
        {toCheck > 0 && (
          <Badge variant="warning">
            <TriangleAlert aria-hidden />
            ต้องตรวจ {toCheck} จุด
          </Badge>
        )}
      </div>
      {extraction.problems.length > 0 && (
        <Alert>
          {extraction.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </Alert>
      )}
      {rows.length === 0 ? (
        <p className="text-muted-foreground">ไม่พบรายการในไฟล์นี้</p>
      ) : (
        <ul aria-label="รายการที่อ่านได้">
          {rows.map((row) => (
            <ReviewRowEditor
              key={row.key}
              row={row}
              baseCurrency={base}
              problems={rowProblems(row, base)}
              onChange={(patch) => setRows((current) => current.map((r) => (r.key === row.key ? patchRow(r, patch, ctx) : r)))}
            />
          ))}
        </ul>
      )}
      {chosen.some((r) => r.kind === 'opening') && (
        <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
          <Field id="opening-date" label="บันทึกเป็นยอดยกมา ณ วันที่">
            <Input id="opening-date" type="date" value={openingDate} max={today} onChange={(e) => setOpeningDate(e.target.value)} />
          </Field>
          {openingCurrencies.map((currency) => {
            const reference = references[`${currency}|${openingDate}`]
            const value = openingRates[currency]
            return (
              <Field
                key={currency}
                id={`opening-rate-${currency}`}
                label={`เรทเฉลี่ยตอนซื้อ (1 ${currency} = ? ${base})`}
                hint={
                  reference && (
                    <>
                      ไม่รู้?{' '}
                      <button
                        type="button"
                        className="font-semibold text-primary-ink underline underline-offset-[3px]"
                        onClick={() => setOpeningRates((c) => ({ ...c, [currency]: { rate: reference, source: 'estimated' } }))}
                      >
                        ใช้เรทกลาง {fmtRate(reference)} เป็นค่าประมาณ
                      </button>
                      {value?.source === 'estimated' && <Badge variant="estimated" className="ml-1.5">ประมาณ</Badge>}
                    </>
                  )
                }
              >
                <Input
                  id={`opening-rate-${currency}`}
                  inputMode="decimal"
                  value={value?.rate ?? ''}
                  onChange={(e) => setOpeningRates((c) => ({ ...c, [currency]: { rate: e.target.value, source: 'manual' } }))}
                />
              </Field>
            )
          })}
          <p className="text-[12.5px] text-muted-foreground sm:col-span-2">
            {extraction.costIncludesFees === false
              ? 'รูปบอกว่าทุนเฉลี่ยยังไม่รวมค่าคอม ใส่ค่าคอมที่จ่ายไปในช่องค่าธรรมเนียมของแต่ละแถวได้'
              : 'ทุนเฉลี่ยในแอปโบรกบางเจ้ารวมค่าคอมแล้ว บางเจ้ายังไม่รวม ถ้ายังไม่รวม ใส่ค่าคอมในช่องค่าธรรมเนียมของแต่ละแถว'}
          </p>
        </div>
      )}
      {hasPrices && (
        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} />
          อัปเดตราคาล่าสุดจากรูปด้วย
        </label>
      )}
      {errors.length > 0 && (
        <Alert tone="error">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saving || chosen.length === 0} onClick={() => void confirm()}>
          <Check aria-hidden />
          ยืนยันบันทึก {chosen.length} รายการ
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ยกเลิก
        </Button>
      </div>
    </div>
  )
}
