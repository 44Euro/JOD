import { useState, type ReactNode } from 'react'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { db } from '../../db/db'
import { setTaxFund } from '../../db/repo'
import { todayLocal } from '../../domain/dates'
import { D, parseDecimalInput } from '../../domain/decimal'
import { RETIREMENT_COMBINED_CAP, TAX_FUND_RULES, TAX_RULES_YEAR, fundPurchases, incomeForTax, taxFundOf, taxFundStatus } from '../../domain/tax'
import { TAX_FUNDS, symbolOf, type TaxFund } from '../../domain/types'
import { yearsWithData, yearSummary } from '../../domain/yearSummary'
import { investorFlows } from '../../domain/investor'
import { PageHeader } from '../components/PageHeader'
import { fmtDate, fmtHeadline, fmtNumber } from '../format'
import { useAppData, useLedger } from '../hooks'
import { t } from '../../i18n'

function Line({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-muted py-2.5 first:border-t-0">
      <dt className="text-muted-foreground">
        {label}
        {note && <span className="block text-[12px]">{note}</span>}
      </dt>
      <dd className="text-right font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

export function TaxPage() {
  const data = useAppData()
  const ledger = useLedger(data)
  const today = todayLocal()
  const [chosen, setChosen] = useState<number | null>(null)
  const [income, setIncome] = useState('')
  if (!data || !ledger) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>

  const years = yearsWithData(data.transactions, today)
  const year = chosen ?? years[0]
  const money = (v: Parameters<typeof fmtHeadline>[0]) => fmtHeadline(v, data.settings.baseCurrency)
  const lines = incomeForTax(year, ledger, data.instruments)
  const remitted = yearSummary(year, data.transactions, ledger, investorFlows(data.transactions, ledger), []).remittedBase
  const incomeValue = parseDecimalInput(income)
  const funds = fundPurchases(year, data.transactions, data.instruments, incomeValue ? D(incomeValue) : null)
  const status = taxFundStatus(data.transactions, data.instruments)
  const yearBreaches = status.breaches.filter((b) => b.soldOn.startsWith(`${year}-`))
  const fundInstruments = data.instruments.filter((i) => i.assetType === 'fund')

  return (
    <>
      <PageHeader title={t('ช่วยเตรียมภาษี')}>
        <NativeSelect aria-label={t('ปีภาษี')} className="h-10 w-auto" value={year} onChange={(e) => setChosen(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              
              {t('ปีภาษี ')}{y + 543} ({y})
            </option>
          ))}
        </NativeSelect>
      </PageHeader>
      <Alert role="note">
        
        {t('ตัวเลขช่วยเตรียมยื่นภาษีจากรายการที่บันทึก ใช้เงื่อนไขกองทุนลดหย่อนตามที่ประกาศสำหรับการซื้อตั้งแต่ปี ')}{TAX_RULES_YEAR + 543} {t(' · ไม่ใช่คำแนะนำทางภาษี ตรวจกับหนังสือรับรองจากโบรก บลจ. และกรมสรรพากรก่อนยื่น')}
      </Alert>

      <div className="grid items-start gap-3.5 md:gap-[22px] lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t('เงินได้จากการลงทุนในไทย')}</h2>
          <dl className="text-sm">
            <Line label={t('ปันผล (ก่อนภาษี)')} note={t('{0} ครั้ง', lines.thaiDividend.count)} value={money(lines.thaiDividend.grossBase)} />
            <Line label={t('ภาษีปันผลที่ถูกหัก ณ ที่จ่าย')} value={money(lines.thaiDividend.taxBase)} />
            <Line label={t('ดอกเบี้ย / คูปอง (ก่อนภาษี)')} note={t('{0} ครั้ง', lines.thaiInterest.count)} value={money(lines.thaiInterest.grossBase)} />
            <Line label={t('ภาษีดอกเบี้ยที่ถูกหัก ณ ที่จ่าย')} value={money(lines.thaiInterest.taxBase)} />
          </dl>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('ปันผลหุ้นไทยเลือกได้ว่าจะจบที่ภาษีหัก ณ ที่จ่าย หรือนำมารวมคำนวณเพื่อขอเครดิตภาษีปันผล')}</p>
        </Card>

        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t('เงินได้จากต่างประเทศ')}</h2>
          <dl className="text-sm">
            <Line label={t('ปันผลและดอกเบี้ยต่างประเทศ (ก่อนภาษี)')} note={t('{0} ครั้ง', lines.foreign.count)} value={money(lines.foreign.grossBase)} />
            <Line label={t('ภาษีที่ต่างประเทศหักไว้')} value={money(lines.foreign.taxBase)} />
            <Line label={t('เงินที่โอนกลับเข้าไทย ปีภาษี {0}', year + 543)} note={t('จากรายการถอนที่ติ๊ก โอนกลับเข้าไทย')} value={money(remitted)} />
          </dl>
          <p className="mt-2 text-[12px] text-muted-foreground">
            
            {t('เงินได้จากต่างประเทศที่เกิดตั้งแต่ปี 2567 ต้องนำมารวมคำนวณภาษีในปีที่นำเข้าไทย · แอปไม่รู้ว่าเงินที่โอนกลับเป็นเงินต้นหรือกำไรเท่าไหร่ ตรวจกับหลักฐานของคุณ')}
          </p>
        </Card>

        <Card className="grid gap-3">
          <h2 className="text-lg font-semibold">{t('กองทุนลดหย่อนที่ซื้อในปีนี้')}</h2>
          <Field id="tax-income" label={t('เงินได้ทั้งปี (ไม่บังคับ)')} hint={t('ใส่เพื่อคำนวณวงเงินลดหย่อน · ไม่ถูกบันทึก')} className="sm:max-w-xs">
            <Input id="tax-income" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} />
          </Field>
          {funds.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ไม่มีการซื้อ SSF, RMF หรือ ThaiESG ในปีนี้')}</p>
          ) : (
            <dl className="text-sm">
              {funds.rows.map((row) => (
                <Line
                  key={row.kind}
                  label={TAX_FUND_RULES[row.kind].label}
                  note={t('สูงสุด {0}% ของเงินได้ ไม่เกิน {1} · ถือ {2} ปี', TAX_FUND_RULES[row.kind].pctOfIncome, fmtNumber(D(TAX_FUND_RULES[row.kind].cap), 0), TAX_FUND_RULES[row.kind].years)}
                  value={row.deductibleBase ? t('{0} · ลดหย่อนได้ {1}', money(row.boughtBase), money(row.deductibleBase)) : money(row.boughtBase)}
                />
              ))}
            </dl>
          )}
          {funds.retirementOverCap && (
            <Alert>{t('SSF + RMF รวมกับเงินสะสมเพื่อการเกษียณอื่นๆ ลดหย่อนได้รวมไม่เกิน ')}{fmtNumber(D(RETIREMENT_COMBINED_CAP), 0)}</Alert>
          )}
        </Card>

        <Card className="grid gap-3">
          <h2 className="text-lg font-semibold">{t('เงื่อนไขการถือกองทุนลดหย่อน')}</h2>
          {yearBreaches.length > 0 && (
            <Alert tone="error">
              {yearBreaches.map((b) => (
                <p key={`${b.saleTxId}-${b.boughtOn}`}>
                  
                  {t('ขาย ')}{symbolOf(b.instrumentId)} {fmtNumber(b.quantity, 4)} {t(' หน่วยเมื่อ ')}{fmtDate(b.soldOn)} {t(' ก่อนครบกำหนด (')}{fmtDate(b.freeFrom)}{t(') · อาจต้องคืนสิทธิลดหย่อนของปีที่ซื้อ (')}
                  {Number(b.boughtOn.slice(0, 4)) + 543})
                </p>
              ))}
            </Alert>
          )}
          {status.lots.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ไม่มีกองทุนลดหย่อนที่ถืออยู่')}</p>
          ) : (
            <ul aria-label={t('หน่วยที่ถืออยู่')} className="text-sm">
              {status.lots.map((lot) => (
                <li key={`${lot.instrumentId}-${lot.txId}`} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-muted py-2.5 first:border-t-0">
                  <span>
                    <b className="font-display">{symbolOf(lot.instrumentId)}</b> <Badge>{TAX_FUND_RULES[lot.kind].label}</Badge>
                    <span className="block text-[12px] text-muted-foreground">
                      
                      {t('ซื้อ ')}{fmtDate(lot.boughtOn)} · {fmtNumber(lot.quantity, 4)} {t(' หน่วย')}
                    </span>
                  </span>
                  <span className={lot.freeFrom <= today ? 'text-gain' : ''}>{lot.freeFrom <= today ? t('ขายได้แล้ว') : t('ขายได้ตั้งแต่ {0}', fmtDate(lot.freeFrom))}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] text-muted-foreground">{t('นับแบบซื้อก่อนขายก่อนตามที่ บลจ. ใช้ · RMF ต้องถือถึงอายุ 55 ปีด้วย แอปไม่รู้อายุของคุณ')}</p>
          {fundInstruments.length > 0 && (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary-ink">{t('กำหนดประเภทกองทุนเอง')}</summary>
              <ul className="grid gap-2">
                {fundInstruments.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span>{i.symbol}</span>
                    <NativeSelect
                      aria-label={t('ประเภทลดหย่อนของ {0}', i.symbol)}
                      className="h-10 w-auto"
                      value={taxFundOf(i) ?? ''}
                      onChange={(e) => void setTaxFund(db, i.id, (e.target.value || null) as TaxFund | null)}
                    >
                      <option value="">{t('ไม่ใช่กองทุนลดหย่อน')}</option>
                      {TAX_FUNDS.map((k) => (
                        <option key={k} value={k}>
                          {TAX_FUND_RULES[k].label}
                        </option>
                      ))}
                    </NativeSelect>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      </div>
    </>
  )
}
