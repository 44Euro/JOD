import { useState } from 'react'
import { Alert } from '../../components/ui/alert'
import { Card } from '../../components/ui/card'
import { Segmented } from '../../components/ui/segmented'
import { Table, Td, Th } from '../../components/ui/table'
import { todayLocal } from '../../domain/dates'
import { sumBy } from '../../domain/decimal'
import { currencyAllocation, groupHoldings, holdingStats } from '../../domain/holdings'
import { positionValueBase } from '../../domain/investor'
import { accountTracksCash } from '../../domain/ledger'
import { cn } from '../../lib/cn'
import { CurrencyView, MarketView } from '../components/AllocationViews'
import { HoldingsTable } from '../components/HoldingsTable'
import { PageHeader } from '../components/PageHeader'
import { Stat, SummaryPanel } from '../components/Summary'
import { fmtHeadline, fmtMoney, fmtSigned, fmtValue, plClass } from '../format'
import { useAppData, useInvestor } from '../hooks'
import { marketOf } from '../labels'

type View = 'asset' | 'account' | 'market' | 'currency'

const VIEWS = [
  { value: 'asset', label: 'ตามสินทรัพย์' },
  { value: 'account', label: 'ตามบัญชี' },
  { value: 'market', label: 'ตามตลาด' },
  { value: 'currency', label: 'ตามสกุลเงิน' },
] as const satisfies readonly { value: View; label: string }[]

export function PortfolioPage() {
  const data = useAppData()
  const { ledger, valuations, summary, rates, investor } = useInvestor(data)
  const [view, setView] = useState<View>('asset')
  if (!data || !ledger || !investor) return <p className="text-muted-foreground">กำลังโหลด…</p>

  const base = data.settings.baseCurrency
  const today = todayLocal()
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const stats = holdingStats(valuations, ledger, today)
  const statsByKey = new Map(stats.map((s) => [s.key, s]))
  const { cash } = investor.worth
  const unrated = [...new Set(cash.filter((row) => row.base === null).map((row) => row.currency))]
  const usedAccounts = [...new Set(data.transactions.map((t) => t.accountId))]
  const tradeOnly = usedAccounts.some((id) => !accountTracksCash(data.transactions, id))

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="มุมมอง" options={VIEWS} value={view} onChange={setView} />
        <span className="text-[13px] text-muted-foreground max-md:hidden">ราคาที่เก่ากว่า 7 วันมีป้ายเตือน · แตะราคาเพื่อแก้</span>
      </div>

      {valuations.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">ยังไม่มีสินทรัพย์ที่ถืออยู่</p>
        </Card>
      ) : view === 'asset' ? (
        <Card>
          <HoldingsTable
            valuations={valuations}
            instruments={instruments}
            accountNames={accountNames}
            base={base}
            rates={rates}
            stats={statsByKey}
            editablePrice
          />
        </Card>
      ) : view === 'account' ? (
        data.accounts
          .filter((account) => valuations.some((v) => v.position.accountId === account.id))
          .map((account) => {
            const mine = valuations.filter((v) => v.position.accountId === account.id)
            return (
              <Card key={account.id}>
                <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-lg font-semibold">{account.name}</h2>
                  <span className="text-[13px] text-muted-foreground">
                    มูลค่า {fmtHeadline(sumBy(mine, positionValueBase), base)} · {mine.length} ตัว
                  </span>
                </div>
                <HoldingsTable valuations={mine} instruments={instruments} base={base} rates={rates} stats={statsByKey} editablePrice />
              </Card>
            )
          })
      ) : (
        <Card>
          {view === 'market' ? (
            <MarketView groups={groupHoldings(stats, (s) => instruments.get(s.instrumentId)?.market ?? marketOf(s.instrumentId))} base={base} />
          ) : (
            <CurrencyView rows={currencyAllocation(valuations, cash)} base={base} />
          )}
        </Card>
      )}

      <Card>
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">เงินสดคงเหลือ</h2>
          {cash.length > 0 && <span className="text-[13px] text-muted-foreground">รวม ≈ {fmtMoney(investor.worth.cashBase, base)}</span>}
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
                  <Td className="text-right text-muted-foreground">{fmtValue(row.base)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {unrated.length > 0 && (
          <p className="mt-3 text-[12.5px] text-muted-foreground">ยังไม่มีเรทวันนี้ของ {unrated.join(', ')} จึงยังไม่รวมในยอดรวม</p>
        )}
        {tradeOnly && (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            บัญชีที่จดแค่ซื้อขาย ไม่นับเงินสด (ไม่มีรายการฝาก ถอน หรือแลกเงิน)
          </p>
        )}
      </Card>
    </>
  )
}
