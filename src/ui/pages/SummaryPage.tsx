import { useLiveQuery } from 'dexie-react-hooks'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { NativeSelect } from '../../components/ui/input'
import { db } from '../../db/db'
import { todayLocal } from '../../domain/dates'
import { investorFlows } from '../../domain/investor'
import { matchTrades } from '../../domain/trades'
import { tradeStats } from '../../domain/tradeStats'
import { yearSummary, yearsWithData } from '../../domain/yearSummary'
import { PageHeader } from '../components/PageHeader'
import { fmtDate, fmtHeadline, fmtPct, fmtSigned, plClass } from '../format'
import { useAppData, useLedger } from '../hooks'
import { t } from '../../i18n'
import { PageLoading } from '../components/PageLoading'

function Row({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-muted py-2.5 first:border-t-0">
      <dt className="text-muted-foreground">
        {label}
        {note && <span className="block text-[12px]">{note}</span>}
      </dt>
      <dd className={`text-right font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}

export function SummaryPage() {
  const data = useAppData()
  const ledger = useLedger(data)
  const days = useLiveQuery(() => db.dailyValues.toArray(), [])
  const today = todayLocal()
  const [chosen, setChosen] = useState<number | null>(null)
  if (!data || !ledger || !days) return <PageLoading />

  const years = yearsWithData(data.transactions, today)
  const year = chosen ?? years[0]
  const base = data.settings.baseCurrency
  const money = (v: Parameters<typeof fmtHeadline>[0]) => fmtHeadline(v, base)
  const s = yearSummary(year, data.transactions, ledger, investorFlows(data.transactions, ledger), days)
  const closed = matchTrades(data.transactions, ledger).filter((t) => t.closeDate?.startsWith(`${year}-`))
  const stats = tradeStats(closed)
  const incomeTotal = s.income.dividend.grossBase.plus(s.income.interest.grossBase).plus(s.income.receive_asset.grossBase)
  const taxTotal = s.income.dividend.taxBase.plus(s.income.interest.taxBase).plus(s.income.receive_asset.taxBase)

  return (
    <>
      <PageHeader title={t('สรุปปี {0}', year)}>
        <NativeSelect aria-label={t('ปี')} className="h-10 w-auto print:hidden" value={year} onChange={(e) => setChosen(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} {t(' (พ.ศ. ')}{y + 543})
            </option>
          ))}
        </NativeSelect>
        <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}>
          <Printer aria-hidden />
          {t('พิมพ์ / บันทึกเป็น PDF')}
        </Button>
      </PageHeader>
      <p className="text-[13px] text-muted-foreground">
        {t('ปี ค.ศ. ')}{year} {t(' · พ.ศ. ')}{year + 543} {t(' · คิดเป็น ')}{base} {t(' ที่เรทของแต่ละรายการ · ทำเมื่อ ')}{fmtDate(today)}
      </p>

      <div className="grid items-start gap-3.5 md:gap-6 lg:grid-cols-2 print:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t('มูลค่าพอร์ต')}</h2>
          <dl className="text-sm">
            <Row label={t('ต้นปี')} note={s.startValue ? fmtDate(s.startValue.date) : t('ไม่มีบันทึก')} value={s.startValue ? money(s.startValue.valueBase) : '—'} />
            <Row label={t('ปลายปี / ล่าสุด')} note={s.endValue ? fmtDate(s.endValue.date) : t('ไม่มีบันทึก')} value={s.endValue ? money(s.endValue.valueBase) : '—'} />
            <Row label={t('เงินที่ใส่เพิ่ม')} value={money(s.putInBase)} />
            <Row label={t('เงินที่ถอนออก')} value={money(s.takenOutBase)} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t('กำไรและรายได้')}</h2>
          <dl className="text-sm">
            <Row label={t('กำไรที่ขายแล้ว')} note={t('{0} รายการขาย', s.sells)} value={fmtSigned(s.realizedBase, 0)} tone={plClass(s.realizedBase)} />
            <Row label={t('ปันผล (ก่อนภาษี)')} value={money(s.income.dividend.grossBase)} />
            <Row label={t('ดอกเบี้ย / คูปอง')} value={money(s.income.interest.grossBase)} />
            <Row label={t('รับเป็นสินทรัพย์')} value={money(s.income.receive_asset.grossBase)} />
            <Row label={t('ภาษีที่ถูกหัก ณ ที่จ่าย')} value={money(taxTotal)} />
            <Row label={t('รายได้สุทธิหลังภาษี')} value={money(incomeTotal.minus(taxTotal))} />
            <Row label={t('ค่าธรรมเนียมรวม')} value={money(s.feesBase)} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t('การเทรด')}</h2>
          <dl className="text-sm">
            <Row label={t('เทรดที่ปิดในปีนี้')} value={String(stats.closed)} />
            <Row label="Win rate" value={fmtPct(stats.winRatePct, 0)} />
            <Row label={t('รวม')} value={fmtSigned(stats.totalBase, 0)} tone={plClass(stats.totalBase)} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t('ภาษี')}</h2>
          <dl className="text-sm">
            <Row label={t('เงินได้จากต่างประเทศที่นำเข้าไทย ปีภาษี {0}', year + 543)} value={money(s.remittedBase)} note={t('จากรายการถอนที่ติ๊ก โอนกลับเข้าไทย')} />
          </dl>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('ตัวเลขช่วยเตรียมยื่นภาษี ไม่ใช่คำแนะนำทางภาษี ตรวจกับเอกสารจากโบรกและผู้เชี่ยวชาญก่อนยื่น')}</p>
          <Link to="/tax" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary-ink underline underline-offset-[3px] print:hidden">
            {t('ดูรายงานช่วยเตรียมภาษีแบบละเอียด')}
          </Link>
        </Card>
      </div>
    </>
  )
}
