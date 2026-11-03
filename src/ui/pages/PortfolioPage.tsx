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
import { unpricedInstrumentCount } from '../../domain/valuation'
import { cn } from '../../lib/cn'
import { CurrencyView, MarketView } from '../components/AllocationViews'
import { HoldingsTable, MissingRatesNote } from '../components/HoldingsTable'
import { PageHeader } from '../components/PageHeader'
import { PortfolioSwitch } from '../components/PortfolioSwitch'
import { PriceUpdateButton } from '../components/PriceUpdateButton'
import { Stat, SummaryPanel } from '../components/Summary'
import { fmtHeadline, fmtMoney, fmtSigned, fmtValue, plClass } from '../format'
import { useAppData, useInvestor } from '../hooks'
import { marketOf } from '../labels'
import { EyeButton } from '../privacy'
import { useIsDesktop } from '../useIsDesktop'
import { t } from '../../i18n'

type View = 'asset' | 'account' | 'market' | 'currency'

const VIEWS = [
  { value: 'asset', label: t('ตามสินทรัพย์') },
  { value: 'account', label: t('ตามบัญชี') },
  { value: 'market', label: t('ตามตลาด') },
  { value: 'currency', label: t('ตามสกุลเงิน') },
] as const satisfies readonly { value: View; label: string }[]

function UnpricedNote({ className }: { className?: string }) {
  return <p className={cn('text-[12.5px] text-muted-foreground', className)}>{t('ตัวที่ยังไม่มีราคานับตามต้นทุน')}</p>
}

export function PortfolioPage() {
  const data = useAppData()
  const { ledger, valuations, summary, rates, investor } = useInvestor(data)
  const isDesktop = useIsDesktop()
  const [view, setView] = useState<View>('asset')
  if (!data || !ledger || !investor) return <p className="text-muted-foreground">{t('กำลังโหลด…')}</p>

  const base = data.settings.baseCurrency
  const today = todayLocal()
  const instruments = new Map(data.instruments.map((i) => [i.id, i]))
  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]))
  const stats = holdingStats(valuations, ledger, today)
  const statsByKey = new Map(stats.map((s) => [s.key, s]))
  const { cash } = investor.worth
  const unrated = [...new Set(cash.filter((row) => row.base === null).map((row) => row.currency))]
  const usedAccounts = [...new Set(data.transactions.flatMap((t) => (t.toAccountId ? [t.accountId, t.toAccountId] : [t.accountId])))]
  const tradeOnly = usedAccounts.some((id) => !accountTracksCash(data.transactions, id))
  const currencyRows = currencyAllocation(valuations, cash)
  const unpriced = unpricedInstrumentCount(valuations)
  // Spec 7.4 counts cash in the currency view, so cash alone still has something to show there.
  const nothingToShow = valuations.length === 0 && !(view === 'currency' && currencyRows.length > 0)
  const hasPriceInput = valuations.length > 0 && (view === 'asset' || view === 'account')

  return (
    <>
      <PageHeader title={t('พอร์ต')}>
        <EyeButton />
        <PriceUpdateButton data={data} ledger={ledger} />
      </PageHeader>
      <PortfolioSwitch />

      <SummaryPanel label={t('มูลค่าสินทรัพย์ · ไม่รวมเงินสด')} value={fmtHeadline(summary.marketValueBase, base)}>
        <Stat label={t('ยังไม่ขาย')} value={fmtSigned(summary.unrealizedBase, 0)} tone={plClass(summary.unrealizedBase)} />
        <Stat label={t('จากหุ้น')} value={fmtSigned(summary.priceEffectBase, 0)} tone={plClass(summary.priceEffectBase)} />
        <Stat label={t('จากค่าเงิน')} value={fmtSigned(summary.fxEffectBase, 0)} tone="text-fx" />
      </SummaryPanel>

      {unpriced > 0 && (
        <Alert role="note">{t('ยังไม่มีราคาล่าสุด ')}{unpriced} {t(' ตัว กรอกในช่องราคาด้านล่าง แล้วตัวเลขด้านบนจะรวมให้')}</Alert>
      )}
      <MissingRatesNote currencies={investor.worth.missingRates} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label={t('มุมมอง')} options={VIEWS} value={view} onChange={setView} />
        {hasPriceInput && (
          <span className="text-[13px] text-muted-foreground max-md:hidden">{t('แตะราคาเพื่อแก้')}</span>
        )}
      </div>

      {nothingToShow ? (
        <Card>
          <p className="text-muted-foreground">{t('ยังไม่มีสินทรัพย์ที่ถืออยู่')}</p>
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
        <>
          {data.accounts
            .filter((account) => valuations.some((v) => v.position.accountId === account.id))
            .map((account) => {
              const mine = valuations.filter((v) => v.position.accountId === account.id)
              return (
                <Card key={account.id}>
                  <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="text-lg font-semibold">{account.name}</h2>
                    <span className="text-[13px] text-muted-foreground">
                      {t('มูลค่า ')}{fmtHeadline(sumBy(mine, positionValueBase), base)} · {mine.length} {t(' ตัว')}
                    </span>
                  </div>
                  <HoldingsTable valuations={mine} instruments={instruments} base={base} rates={rates} stats={statsByKey} editablePrice />
                </Card>
              )
            })}
          {unpriced > 0 && <UnpricedNote />}
        </>
      ) : (
        <Card>
          {view === 'market' ? (
            <MarketView groups={groupHoldings(stats, (s) => instruments.get(s.instrumentId)?.market ?? marketOf(s.instrumentId))} base={base} />
          ) : (
            <CurrencyView rows={currencyRows} base={base} />
          )}
          {unpriced > 0 && <UnpricedNote className="mt-1" />}
        </Card>
      )}

      <Card>
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('เงินสดคงเหลือ')}</h2>
          {cash.length > 0 && <span className="text-[13px] text-muted-foreground">{t('รวม ≈ ')}{fmtHeadline(investor.worth.cashBase, base)}</span>}
        </div>
        {cash.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('ยังไม่มีเงินสดที่บันทึกไว้')}</p>
        ) : !isDesktop ? (
          <ul aria-label={t('เงินสดคงเหลือ')}>
            {cash.map((row) => (
              <li
                key={`${row.accountId}|${row.currency}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0"
              >
                <span className="min-w-0 truncate">{accountNames.get(row.accountId) ?? '—'}</span>
                <span className={cn('font-display font-semibold', row.amount.lessThan(0) && 'text-loss')}>
                  {fmtMoney(row.amount, row.currency)}
                </span>
                {row.base !== null && row.currency !== base && (
                  <span className="col-span-2 text-[12.5px] text-muted-foreground">≈ {fmtHeadline(row.base, base)}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('บัญชี')}</Th>
                <Th className="text-right">{t('ยอดคงเหลือ')}</Th>
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
          <p className="mt-3 text-[12.5px] text-muted-foreground">{t('ยังไม่มีเรทวันนี้ของ ')}{unrated.join(', ')} {t(' จึงยังไม่รวมในยอดรวม')}</p>
        )}
        {tradeOnly && (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            {t('บัญชีที่จดแค่ซื้อขาย ไม่นับเงินสด (ไม่มีรายการฝาก ถอน หรือแลกเงิน)')}
          </p>
        )}
      </Card>
    </>
  )
}
