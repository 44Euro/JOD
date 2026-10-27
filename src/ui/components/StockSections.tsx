import { useEffect, useState } from 'react'
import { Chip } from '../../components/ui/chip'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Segmented } from '../../components/ui/segmented'
import { Table, Td, Th } from '../../components/ui/table'
import { TERMINAL_GROWTH_PCT, dcf, historicalGrowthPct } from '../../domain/dcf'
import { D, Decimal, parseDecimalInput } from '../../domain/decimal'
import type { FinancialPeriod, Financials } from '../../market/client'
import { cn } from '../../lib/cn'
import { fmtDate, fmtPct, fmtPrice } from '../format'
import type { MarketState } from '../useMarket'
import { MarketCard } from './MarketCard'
import { MarketNote } from './NewsList'
import { t } from '../../i18n'

const FILINGS_OFF = t('งบการเงินยังไม่เปิด: เซิร์ฟเวอร์ยังไม่ได้ตั้งชื่อผู้ขอข้อมูลกับ SEC (SEC_USER_AGENT)')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

// Filings run to hundreds of billions; 416.2B reads at a glance where a full figure would not fit a phone.
export function fmtCompact(value: string | null): string {
  return value === null ? '—' : compact.format(Number(value)).replace('-', '−')
}

// SEC aligns each fiscal period to the calendar: CY2025 is the fiscal year that ended in 2025.
function periodLabel(period: string): string {
  const quarter = /^CY(\d{4})Q(\d)$/.exec(period)
  return quarter ? `Q${quarter[2]} ${quarter[1]}` : period.slice(2)
}

const ROWS: { key: keyof Pick<FinancialPeriod, 'revenue' | 'netIncome' | 'freeCashFlow'>; label: string }[] = [
  { key: 'revenue', label: t('รายได้') },
  { key: 'netIncome', label: t('กำไรสุทธิ') },
  { key: 'freeCashFlow', label: t('กระแสเงินสดอิสระ') },
]

export function FinancialsSection({ state }: { state: MarketState<Financials> }) {
  const [view, setView] = useState<'annual' | 'quarterly'>('annual')
  const periods = state.status === 'ready' ? state.data[view] : []
  const last = periods.at(-1)
  const source = last
    ? view === 'annual'
      ? t('ที่มา SEC · งบปี {0} สิ้นสุด {1}', periodLabel(last.period), fmtDate(last.end))
      : t('ที่มา SEC · ไตรมาส {0} สิ้นสุด {1}', periodLabel(last.period), fmtDate(last.end))
    : t('ที่มา SEC')
  const top = Math.max(...periods.map((p) => Number(p.revenue ?? 0)), 1)
  return (
    <MarketCard title={t('งบการเงิน')} source={source}>
      {state.status !== 'ready' ? (
        <MarketNote state={state} offText={FILINGS_OFF} />
      ) : (
        <div className="grid gap-3">
          <Segmented
            label={t('ช่วงงบ')}
            options={[
              { value: 'annual', label: t('ปี') },
              { value: 'quarterly', label: t('ไตรมาส') },
            ]}
            value={view}
            onChange={setView}
          />
          {periods.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">{t('ไม่มีตัวเลขช่วงนี้ใน SEC')}</p>
          ) : (
            <>
              <div aria-hidden className="flex h-14 items-end gap-2 pl-[38%]">
                {periods.map((p) => (
                  <span key={p.period} className="flex-1 rounded-t-[4px] bg-primary/80" style={{ height: `${(Number(p.revenue ?? 0) / top) * 100}%` }} />
                ))}
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-[38%]" />
                    {periods.map((p) => (
                      <Th key={p.period} className="text-right">
                        {periodLabel(p.period)}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.key}>
                      <Th scope="row" className="border-t border-muted py-3 text-[13.5px] text-ink-2">
                        {row.label}
                      </Th>
                      {periods.map((p) => (
                        <Td key={p.period} className={cn('text-right font-display', Number(p[row.key]) < 0 && 'text-loss')}>
                          {fmtCompact(p[row.key])}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="text-[12px] text-muted-foreground">{t('หน่วย USD · B = พันล้าน · M = ล้าน')}</p>
            </>
          )}
        </div>
      )}
    </MarketCard>
  )
}

function defaults(financials: Financials) {
  const flows = financials.annual.flatMap((p) => (p.freeCashFlow === null ? [] : [D(p.freeCashFlow)]))
  const history = historicalGrowthPct(flows)
  const growth = history ? Decimal.min(Decimal.max(history, 0), 15).toDecimalPlaces(1) : D(5)
  return { growth: growth.toString(), discount: '10', years: '5' }
}

// The person's own estimate: three inputs, one answer, and every assumption written next to it.
export function ValuationSection({ state, price }: { state: MarketState<Financials>; price: string | null }) {
  const financials = state.status === 'ready' ? state.data : null
  return (
    <MarketCard title={t('มูลค่า (DCF)')} source={t('ที่มา SEC · คำนวณในเครื่องนี้')}>
      {financials ? <Valuation key={financials.symbol} financials={financials} price={price} /> : <MarketNote state={state} offText={FILINGS_OFF} />}
    </MarketCard>
  )
}

function Valuation({ financials, price }: { financials: Financials; price: string | null }) {
  const [inputs, setInputs] = useState(() => defaults(financials))
  const latest = [...financials.annual].reverse().find((p) => p.freeCashFlow !== null)
  const growth = parseDecimalInput(inputs.growth)
  const discount = parseDecimalInput(inputs.discount)
  const years = /^\d{1,2}$/.test(inputs.years) ? Number(inputs.years) : 0
  const flow = latest?.freeCashFlow ? D(latest.freeCashFlow) : null
  let answer: string
  let value = null
  if (!flow || flow.lte(0)) answer = t('กระแสเงินสดอิสระปีล่าสุดติดลบหรือไม่มี จึงประเมินแบบ DCF ไม่ได้')
  else if (!financials.shares) answer = t('ไม่มีจำนวนหุ้นจาก SEC จึงคิดเป็นราคาต่อหุ้นไม่ได้')
  else if (growth === null || discount === null || years < 1) answer = t('ใส่ตัวเลขให้ครบ จำนวนปีตั้งแต่ 1 ปี')
  else if (D(discount).lte(TERMINAL_GROWTH_PCT)) answer = t('ผลตอบแทนที่ต้องการต้องมากกว่า {0}%', TERMINAL_GROWTH_PCT.toString())
  else {
    value = dcf({ freeCashFlow: flow, shares: D(financials.shares), growthPct: D(growth), discountPct: D(discount), years })
    answer = ''
  }
  const gap = value && price && D(price).gt(0) ? value.perShare.div(price).minus(1).times(100) : null
  const field = (key: keyof typeof inputs, label: string, mode: 'decimal' | 'numeric') => (
    <Field id={`dcf-${key}`} label={label}>
      <Input id={`dcf-${key}`} inputMode={mode} value={inputs[key]} onChange={(e) => setInputs({ ...inputs, [key]: e.target.value })} />
    </Field>
  )
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-2.5">
        {field('growth', t('การเติบโตต่อปี (%)'), 'decimal')}
        {field('discount', t('ผลตอบแทนที่ต้องการ (%)'), 'decimal')}
        {field('years', t('จำนวนปี'), 'numeric')}
      </div>
      {value ? (
        <div>
          <p className="text-[13.5px] text-muted-foreground">{t('มูลค่าที่ประเมินได้ต่อหุ้น')}</p>
          <p className="font-display text-[34px] font-semibold leading-tight">
            {fmtPrice(value.perShare.toDecimalPlaces(2))} <span className="text-[15px] font-normal text-muted-foreground">USD</span>
          </p>
          {gap && price && (
            <p className="text-[15px] text-ink-2">
              {t('ราคาตลาด {0} · ', fmtPrice(price))}
              {gap.gte(0) ? t('สูงกว่าราคาตลาด {0}', fmtPct(gap)) : t('ต่ำกว่าราคาตลาด {0}', fmtPct(gap.abs()))}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[15px] text-ink-2">{answer}</p>
      )}
      <p className="text-[12.5px] text-muted-foreground">
        {flow && t('FCF ปีล่าสุด {0} · ', fmtCompact(flow.toString()))}
        {t('หลังจากนั้นโตปีละ {0}% · ไม่รวมเงินสดและหนี้', TERMINAL_GROWTH_PCT.toString())}
      </p>
      <p className="text-[12.5px] font-semibold text-ink-2">{t('คำนวณจากตัวเลขที่คุณใส่ ไม่ใช่คำแนะนำการลงทุน')}</p>
    </div>
  )
}

// The stock page is one long page; the chips jump to a section and, where the browser can tell, follow the reading.
export function SectionChips({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id)
  const ids = sections.map((s) => s.id).join(',')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id)
      },
      { rootMargin: '-15% 0px -70% 0px' },
    )
    for (const id of ids.split(',')) {
      const section = document.getElementById(id)
      if (section) observer.observe(section)
    }
    return () => observer.disconnect()
  }, [ids])
  if (sections.length < 2) return null
  return (
    <nav aria-label={t('ส่วนของหน้า')} className="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 flex gap-2 overflow-x-auto bg-background px-4 py-2 md:mx-0 md:px-0">
      {sections.map((s) => (
        <Chip
          key={s.id}
          active={active === s.id}
          onClick={() => {
            setActive(s.id)
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          {s.label}
        </Chip>
      ))}
    </nav>
  )
}
