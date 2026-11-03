import type { RowField, RowKind } from '../../../ai/extraction'
import { ROW_KINDS } from '../../../ai/extraction'
import { Field } from '../../../components/ui/field'
import { Input, NativeSelect } from '../../../components/ui/input'
import { CURRENCY_OPTIONS } from '../../../domain/currencies'
import { MARKETS } from '../../../domain/types'
import { cn } from '../../../lib/cn'
import { needsSymbol, usesUnits, type ReviewRow } from '../../importReview'
import { MARKET_LABELS, TX_TYPE_LABELS } from '../../labels'
import { t } from '../../../i18n'

const CHECK = 'border-warning-fg bg-warning-bg'

function NumberField({
  row,
  field,
  label,
  value,
  onChange,
}: {
  row: ReviewRow
  field: RowField | 'fxRate'
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = `${row.key}-${field}`
  const doubtful = field !== 'fxRate' && row.uncertain.includes(field)
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        className={cn('h-10 tabular-nums', doubtful && CHECK)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

export function ReviewRowEditor({
  row,
  baseCurrency,
  problems,
  onChange,
}: {
  row: ReviewRow
  baseCurrency: string
  problems: readonly string[]
  onChange: (patch: Partial<ReviewRow>) => void
}) {
  const title = row.symbol || TX_TYPE_LABELS[row.kind]
  const doubtful = (field: RowField) => row.uncertain.includes(field) && CHECK
  const foreign = row.kind !== 'opening' && row.currency !== baseCurrency
  return (
    <li className={cn('grid gap-3 border-t border-muted py-3.5 first:border-t-0', !row.include && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-primary"
          aria-label={t('บันทึก {0}', title)}
          checked={row.include}
          onChange={(e) => onChange({ include: e.target.checked })}
        />
        <NativeSelect
          aria-label={t('ประเภทของ {0}', title)}
          className="h-10 w-auto"
          value={row.kind}
          onChange={(e) => onChange({ kind: e.target.value as RowKind })}
        >
          {ROW_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {TX_TYPE_LABELS[kind]}
            </option>
          ))}
        </NativeSelect>
        {needsSymbol(row.kind) && (
          <>
            <NativeSelect
              aria-label={t('ตลาดของ {0}', title)}
              className={cn('h-10 w-auto max-w-40', doubtful('market'))}
              value={row.market}
              onChange={(e) => onChange({ market: e.target.value as ReviewRow['market'] })}
            >
              {MARKETS.map((market) => (
                <option key={market} value={market}>
                  {MARKET_LABELS[market]}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label={t('สัญลักษณ์')}
              className={cn('h-10 w-24 min-w-0 flex-1 font-semibold uppercase sm:flex-none', doubtful('symbol'))}
              value={row.symbol}
              onChange={(e) => onChange({ symbol: e.target.value.toUpperCase() })}
            />
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {row.kind !== 'opening' && (
          <Field id={`${row.key}-date`} label={t('วันที่')}>
            <Input
              id={`${row.key}-date`}
              type="date"
              value={row.date}
              className={cn('h-10', doubtful('date'))}
              onChange={(e) => onChange({ date: e.target.value })}
            />
          </Field>
        )}
        {usesUnits(row.kind) ? (
          <>
            <NumberField row={row} field="quantity" label={t('จำนวน')} value={row.quantity} onChange={(quantity) => onChange({ quantity })} />
            <NumberField
              row={row}
              field="price"
              label={row.kind === 'opening' ? t('ทุนเฉลี่ย') : t('ราคา')}
              value={row.price}
              onChange={(price) => onChange({ price })}
            />
          </>
        ) : (
          <NumberField row={row} field="amount" label={t('จำนวนเงิน')} value={row.amount} onChange={(amount) => onChange({ amount })} />
        )}
        {row.kind === 'opening' && (
          <NumberField row={row} field="lastPrice" label={t('ราคาล่าสุด')} value={row.lastPrice} onChange={(lastPrice) => onChange({ lastPrice })} />
        )}
        <NumberField row={row} field="fees" label={t('ค่าธรรมเนียม')} value={row.fees} onChange={(fees) => onChange({ fees })} />
        {row.kind !== 'opening' && (
          <NumberField row={row} field="tax" label={t('ภาษี')} value={row.tax} onChange={(tax) => onChange({ tax })} />
        )}
        <Field id={`${row.key}-currency`} label={t('สกุล')}>
          <NativeSelect
            id={`${row.key}-currency`}
            className={cn('h-10', doubtful('currency'))}
            value={row.currency}
            onChange={(e) => onChange({ currency: e.target.value })}
          >
            {[...new Set([row.currency, ...CURRENCY_OPTIONS])].map((code) => (
              <option key={code}>{code}</option>
            ))}
          </NativeSelect>
        </Field>
        {foreign && (
          <NumberField
            row={row}
            field="fxRate"
            label={t('เรท 1 {0} = ? {1}', row.currency, baseCurrency)}
            value={row.fxRate}
            onChange={(fxRate) => onChange({ fxRate, fxSource: 'manual' })}
          />
        )}
      </div>
      {(row.note || row.duplicate || (row.include && problems.length > 0)) && (
        <p className="text-[12.5px] text-warning-fg">
          {[row.note, row.duplicate && `${row.duplicate}${row.include ? '' : t(' · ไม่ได้เลือกไว้')}`, row.include && problems.join(' · ')]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </li>
  )
}
