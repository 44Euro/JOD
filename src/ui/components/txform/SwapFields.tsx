import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import type { Instrument } from '../../../domain/types'
import type { SwapOutcome } from '../../afterSave'
import { fmtPrice, fmtSigned, plClass } from '../../format'
import { changeMarket, changeToMarket, pickSymbol, pickToSymbol, type Draft } from '../../transactionDraft'
import { FieldGroup } from './FieldGroup'
import { InstrumentFields } from './InstrumentFields'

export function SwapFields({
  draft,
  instruments,
  fromHint,
  toHint,
  setDraft,
}: {
  draft: Draft
  instruments: readonly Instrument[]
  fromHint?: string
  toHint?: string
  setDraft(change: (d: Draft) => Draft): void
}) {
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <>
      <FieldGroup legend="แลกออก">
        <InstrumentFields
          idPrefix="tx"
          symbolLabel="สินทรัพย์ที่แลกออก"
          market={draft.market}
          symbol={draft.symbol}
          name={draft.instrumentName}
          assetType={draft.assetType}
          instruments={instruments}
          hint={fromHint}
          onMarket={(market) => setDraft((d) => changeMarket(d, market, instruments))}
          onSymbol={(symbol) => setDraft((d) => pickSymbol(d, symbol, instruments))}
          onName={(instrumentName) => update({ instrumentName })}
          onAssetType={(assetType) => update({ assetType })}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field id="tx-quantity" label="จำนวนที่แลกออก">
            <Input id="tx-quantity" inputMode="decimal" value={draft.quantity} onChange={(e) => update({ quantity: e.target.value })} />
          </Field>
        </div>
      </FieldGroup>
      <FieldGroup legend="ได้รับ">
        <InstrumentFields
          idPrefix="tx-to"
          symbolLabel="สินทรัพย์ที่ได้รับ"
          market={draft.toMarket}
          symbol={draft.toSymbol}
          name={draft.toInstrumentName}
          assetType={draft.toAssetType}
          instruments={instruments}
          hint={toHint}
          onMarket={(toMarket) => setDraft((d) => changeToMarket(d, toMarket, instruments))}
          onSymbol={(toSymbol) => setDraft((d) => pickToSymbol(d, toSymbol, instruments))}
          onName={(toInstrumentName) => update({ toInstrumentName })}
          onAssetType={(toAssetType) => update({ toAssetType })}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field id="tx-to-quantity" label="จำนวนที่ได้รับ">
            <Input id="tx-to-quantity" inputMode="decimal" value={draft.toQuantity} onChange={(e) => update({ toQuantity: e.target.value })} />
          </Field>
        </div>
      </FieldGroup>
    </>
  )
}

export function SwapSummary({ draft, outcome }: { draft: Draft; outcome: SwapOutcome }) {
  return (
    <p className="rounded-2xl bg-muted px-[18px] py-3 text-[13px]">
      ต้นทุน {draft.toSymbol.trim().toUpperCase()} {fmtPrice(outcome.unitCost)} {draft.currency} ต่อหน่วย · กำไรที่ขายแล้วของ{' '}
      {draft.symbol.trim().toUpperCase()}{' '}
      <span className={plClass(outcome.realizedQuote)}>
        {fmtSigned(outcome.realizedQuote)} {draft.currency}
      </span>
    </p>
  )
}
