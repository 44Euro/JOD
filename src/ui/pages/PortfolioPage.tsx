import { Alert } from '../../components/ui/alert'
import { Card } from '../../components/ui/card'
import { Table, Td, Th } from '../../components/ui/table'
import { D, sumBy } from '../../domain/decimal'
import { cn } from '../../lib/cn'
import { HoldingsTable } from '../components/HoldingsTable'
import { PageHeader } from '../components/PageHeader'
import { Stat, SummaryPanel } from '../components/Summary'
import { fmtHeadline, fmtMoney, fmtNumber, fmtSigned, plClass } from '../format'
import { useAppData, usePortfolio } from '../hooks'

export function PortfolioPage() {
  const data = useAppData()
  const { ledger, valuations, summary, rates } = usePortfolio(data)
  if (!data || !ledger) return <p className="text-muted-foreground">กำลังโหลด…</p>

  const base = data.settings.baseCurrency
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const cash = ledger.cash.map((row) => ({
    ...row,
    base: rates[row.currency] ? row.amount.times(D(rates[row.currency].rate)) : null,
  }))
  const cashTotal = sumBy(cash, (row) => row.base ?? D(0))

  return (
    <>
      <PageHeader title="พอร์ต" />

      <SummaryPanel label="มูลค่าสินทรัพย์ · ไม่รวมเงินสด" value={fmtHeadline(summary.marketValueBase, base)}>
        <Stat label="ยังไม่ขาย" value={fmtSigned(summary.unrealizedBase)} tone={plClass(summary.unrealizedBase)} />
        <Stat label="จากหุ้น" value={fmtSigned(summary.priceEffectBase)} tone={plClass(summary.priceEffectBase)} />
        <Stat label="จากค่าเงิน" value={fmtSigned(summary.fxEffectBase)} tone="text-fx" />
      </SummaryPanel>

      {summary.unvaluedCount > 0 && (
        <Alert role="note">ยังไม่มีราคาล่าสุด {summary.unvaluedCount} ตัว กรอกในช่องราคาด้านล่าง แล้วตัวเลขด้านบนจะรวมให้</Alert>
      )}

      <Card>
        {valuations.length === 0 ? (
          <p className="text-muted-foreground">ยังไม่มีสินทรัพย์ที่ถืออยู่</p>
        ) : (
          <HoldingsTable
            valuations={valuations}
            instruments={instruments}
            accountNames={accountNames}
            base={base}
            rates={rates}
            editablePrice
          />
        )}
      </Card>

      <Card>
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">เงินสดคงเหลือ</h2>
          {cash.length > 0 && <span className="text-[13px] text-muted-foreground">รวม ≈ {fmtMoney(cashTotal, base)}</span>}
        </div>
        {cash.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีเงินสดที่บันทึกไว้</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>บัญชี</Th>
                <Th className="text-right">ยอดคงเหลือ</Th>
                <Th className="text-right">≈ {base}</Th>
              </tr>
            </thead>
            <tbody>
              {cash.map((row) => (
                <tr key={`${row.accountId}|${row.currency}`}>
                  <Td>{accountNames.get(row.accountId) ?? '—'}</Td>
                  <Td className={cn('text-right font-display font-semibold', row.amount.lessThan(0) && 'text-loss')}>
                    {fmtMoney(row.amount, row.currency)}
                  </Td>
                  <Td className="text-right text-muted-foreground">{fmtNumber(row.base, 0)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}
