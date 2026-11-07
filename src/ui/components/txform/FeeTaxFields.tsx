import type { ReactNode } from 'react'
import { Field } from '../../../components/ui/field'
import { Input, NativeSelect } from '../../../components/ui/input'
import type { Account, FeePaidIn, Instrument, TxType } from '../../../domain/types'
import { cn } from '../../../lib/cn'
import { feeTemplateParts } from '../../feeTemplateText'
import { fmtMoney, fmtNumber } from '../../format'
import { FEE_PAID_IN_LABELS } from '../../labels'
import {
  feePaidInOf,
  feePaidInOptions,
  receivedAfterFee,
  showsFeePaidIn,
  templateFee,
  type Draft,
} from '../../transactionDraft'
import { FieldGroup } from './FieldGroup'
import { InstrumentFields } from './InstrumentFields'
import { t } from '../../../i18n'

function feeLabel(type: TxType): string {
  if (type === 'fx_convert') return t('ค่าธรรมเนียม (หักจากยอดที่แลก)')
  return type === 'transfer' ? t('ค่าธรรมเนียมการโอน') : t('ค่าธรรมเนียม')
}

function formulaHint(draft: Draft, account: Account | undefined, restoreFormula: () => void): ReactNode {
  const template = account?.feeTemplate
  if (!account || !template || (draft.type !== 'buy' && draft.type !== 'sell')) return undefined
  if (template.currency !== draft.currency) return t('สูตรของ {0} ใช้กับรายการสกุล {1}', account.name, template.currency)
  const computed = templateFee(draft, account)
  if (computed === null) return undefined
  if (draft.feesSource === 'auto') {
    const { body, minimum } = feeTemplateParts(template)
    return (
      <>
        {t('คำนวณจากสูตรของ ')}{account.name} · {body}
        {minimum && (
          <>
            {' '}
            <span className="whitespace-nowrap">{minimum}</span>
          </>
        )}
      </>
    )
  }
  return (
    <button
      type="button"
      className="inline-flex min-h-11 items-center text-left text-[13px] font-semibold text-primary underline underline-offset-[3px] md:min-h-0"
      onClick={restoreFormula}
    >
      {t('ใช้สูตรของบัญชี (')}{fmtMoney(computed)})
    </button>
  )
}

// The fee asset has to be held already, so the name, type and unit that InstrumentFields asks of a new one are never shown.
const heldOnly = { name: '', assetType: 'other', unit: 'unit', onName: () => {}, onAssetType: () => {}, onUnit: () => {} } as const

export function FeeTaxFields({
  draft,
  account,
  instruments,
  feeHint,
  update,
}: {
  draft: Draft
  account: Account | undefined
  instruments: readonly Instrument[]
  feeHint?: string
  update(patch: Partial<Draft>): void
}) {
  const paidIn = feePaidInOf(draft)
  const showsSelect = showsFeePaidIn(draft)
  const showsTax = draft.type !== 'fx_convert' && draft.type !== 'deposit' && draft.type !== 'transfer'
  const cells = Number(showsSelect) + Number(paidIn !== 'asset') + Number(showsTax)
  const receivedSymbol = (draft.type === 'swap' ? draft.toSymbol : draft.symbol).trim().toUpperCase()
  const arrives = receivedAfterFee(draft)
  const formula = paidIn === 'cash' ? formulaHint(draft, account, () => update({ feesSource: 'auto' })) : undefined
  return (
    <div className="grid gap-3.5">
      <div className={cn('grid grid-cols-2 gap-3.5', cells === 3 && 'sm:grid-cols-3')}>
        {showsSelect && (
          <Field id="tx-fee-paid-in" label={t('จ่ายเป็น')} className={cn(paidIn !== 'cash' && 'col-span-2 sm:col-span-1')}>
            <NativeSelect id="tx-fee-paid-in" value={paidIn} onChange={(e) => update({ feePaidIn: e.target.value as FeePaidIn })}>
              {feePaidInOptions(draft).map((option) => (
                <option key={option} value={option}>
                  {FEE_PAID_IN_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {paidIn === 'cash' && (
          <Field id="tx-fees" label={feeLabel(draft.type)}>
            <Input
              id="tx-fees"
              inputMode="decimal"
              placeholder="0"
              value={draft.fees}
              onChange={(e) => update({ fees: e.target.value, feesSource: 'manual' })}
            />
          </Field>
        )}
        {paidIn === 'received' && (
          <Field
            id="tx-fee-quantity"
            label={receivedSymbol ? t('จำนวนที่ถูกหัก ({0})', receivedSymbol) : t('จำนวนที่ถูกหัก')}
            hint={arrives && t('ได้รับจริง {0} {1}', fmtNumber(arrives, 8), receivedSymbol).trim()}
            className="col-span-2 sm:col-span-1"
          >
            <Input
              id="tx-fee-quantity"
              inputMode="decimal"
              placeholder="0"
              value={draft.feeQuantity}
              onChange={(e) => update({ feeQuantity: e.target.value })}
            />
          </Field>
        )}
        {showsTax && (
          <Field id="tx-tax" label={draft.type === 'dividend' || draft.type === 'interest' ? t('ภาษีหัก ณ ที่จ่าย') : t('ภาษี / VAT')}>
            <Input id="tx-tax" inputMode="decimal" placeholder="0" value={draft.tax} onChange={(e) => update({ tax: e.target.value })} />
          </Field>
        )}
        {formula && (
          // Last in the grid, so on a phone it is a line of its own under the fee and tax; from sm up it sits right under
          // the fee, where a hint of the field would be.
          <p
            className={cn(
              'col-span-2 text-[13px] text-muted-foreground sm:col-span-1 sm:row-start-2 sm:-mt-2',
              showsSelect ? 'sm:col-start-2' : 'sm:col-start-1',
            )}
          >
            {formula}
          </p>
        )}
      </div>
      {paidIn === 'asset' && (
        <FieldGroup legend={t('ค่าธรรมเนียมที่จ่ายเป็นสินทรัพย์')} divided>
          <InstrumentFields
            {...heldOnly}
            idPrefix="tx-fee"
            symbolLabel={t('สินทรัพย์ที่ใช้จ่าย')}
            market={draft.feeMarket}
            symbol={draft.feeSymbol}
            instruments={instruments}
            hint={feeHint}
            allowNew={false}
            onMarket={(feeMarket) => update({ feeMarket })}
            onSymbol={(feeSymbol) => update({ feeSymbol })}
          />
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field id="tx-fee-quantity" label={t('จำนวน')}>
              <Input id="tx-fee-quantity" inputMode="decimal" value={draft.feeQuantity} onChange={(e) => update({ feeQuantity: e.target.value })} />
            </Field>
            <Field id="tx-fees" label={t('มูลค่าค่าธรรมเนียม ({0})', draft.currency)}>
              <Input
                id="tx-fees"
                inputMode="decimal"
                value={draft.fees}
                onChange={(e) => update({ fees: e.target.value, feesSource: 'manual' })}
              />
            </Field>
          </div>
        </FieldGroup>
      )}
    </div>
  )
}
