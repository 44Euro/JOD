import { Table, Td, Th } from '../../components/ui/table'
import type { AllocationRow, HoldingGroup } from '../../domain/holdings'
import type { Market } from '../../domain/types'
import { cn } from '../../lib/cn'
import { fmtPct, fmtSigned, fmtValue, plClass } from '../format'
import { MARKET_LABELS } from '../labels'
import { useIsDesktop } from '../useIsDesktop'
import { CashPill, MarketPill } from './MarketPill'
import { t } from '../../i18n'

function ShareBar({ row }: { row: AllocationRow }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-muted max-lg:hidden">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${row.pct?.toFixed(2) ?? 0}%` }} />
      </span>
      <span className="w-14 text-right tabular-nums max-lg:w-12">{fmtPct(row.pct, 1, 1)}</span>
    </span>
  )
}

function MarketName({ row }: { row: HoldingGroup }) {
  const market = row.key as Market
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <MarketPill market={market} />
      <span className="flex min-w-0 items-center gap-2.5 md:max-lg:flex-col md:max-lg:items-start md:max-lg:gap-0">
        <span className="truncate">{MARKET_LABELS[market]}</span>
        <span className="shrink-0 text-[13px] text-muted-foreground">{row.count} {t(' ตัว')}</span>
      </span>
    </span>
  )
}

// Between a tablet and a laptop the table has about 390px: tighter cells and a stacked count keep every column in view.
const tight = 'max-lg:text-[13px] max-lg:[&_td]:px-1 max-lg:[&_th]:px-1 max-lg:[&_th]:whitespace-normal'

const phoneRow = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-muted py-3 first:border-t-0'

// Spec S4: the market view shares out the assets only; cash has no market.
export function MarketView({ groups, base }: { groups: readonly HoldingGroup[]; base: string }) {
  const isDesktop = useIsDesktop()
  return (
    <>
      {isDesktop ? (
        <Table className={tight}>
          <thead>
            <tr>
              <Th>{t('ตลาด')}</Th>
              <Th className="text-right">{t('มูลค่า (')}{base})</Th>
              <Th className="text-right">{t('สัดส่วน')}</Th>
              <Th className="text-right">{t('ยังไม่ขาย')}</Th>
              <Th className="text-right">{t('ผลตอบแทนรวม')}</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((row) => (
              <tr key={row.key}>
                <Td>
                  <MarketName row={row} />
                </Td>
                <Td className="text-right font-display font-semibold">{fmtValue(row.totalBase)}</Td>
                <Td className="text-right">
                  <ShareBar row={row} />
                </Td>
                <Td className={cn('text-right', plClass(row.unrealizedBase))}>{fmtSigned(row.unrealizedBase, 0)}</Td>
                <Td className={cn('text-right', plClass(row.totalReturnBase))}>{fmtSigned(row.totalReturnBase, 0)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <ul aria-label={t('สัดส่วนตามตลาด')}>
          {groups.map((row) => (
            <li key={row.key} className={phoneRow}>
              <MarketName row={row} />
              <span className="font-display font-semibold">{fmtPct(row.pct, 1, 1)}</span>
              <span className="col-span-2 text-[13px] text-muted-foreground">
                {fmtValue(row.totalBase)} {t(' · ยังไม่ขาย ')}<span className={plClass(row.unrealizedBase)}>{fmtSigned(row.unrealizedBase, 0)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-muted-foreground">{t('สัดส่วนจากมูลค่าสินทรัพย์ ไม่รวมเงินสด')}</p>
    </>
  )
}

export function CurrencyView({ rows, base }: { rows: readonly AllocationRow[]; base: string }) {
  const isDesktop = useIsDesktop()
  return (
    <>
      {isDesktop ? (
        <Table className={tight}>
          <thead>
            <tr>
              <Th>{t('สกุลเงิน')}</Th>
              <Th className="text-right">{t('สินทรัพย์')}</Th>
              <Th className="text-right">{t('เงินสด')}</Th>
              <Th className="text-right">{t('รวม (')}{base})</Th>
              <Th className="text-right">{t('สัดส่วน')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <Td>
                  <CashPill label={row.key} />
                </Td>
                <Td className="text-right">{fmtValue(row.assetsBase)}</Td>
                <Td className="text-right">{fmtValue(row.cashBase)}</Td>
                <Td className="text-right font-display font-semibold">{fmtValue(row.totalBase)}</Td>
                <Td className="text-right">
                  <ShareBar row={row} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <ul aria-label={t('สัดส่วนตามสกุลเงิน')}>
          {rows.map((row) => (
            <li key={row.key} className={phoneRow}>
              <span className="flex">
                <CashPill label={row.key} />
              </span>
              <span className="font-display font-semibold">{fmtPct(row.pct, 1, 1)}</span>
              <span className="col-span-2 text-[13px] text-muted-foreground">
                {t('สินทรัพย์ ')}{fmtValue(row.assetsBase)} {t(' · เงินสด ')}{fmtValue(row.cashBase)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-muted-foreground">{t('สินทรัพย์นับตามสกุลที่ซื้อขาย รวมเงินสดตามสกุล')}</p>
    </>
  )
}
