import { Field } from '../../../components/ui/field'
import { Input, NativeSelect } from '../../../components/ui/input'
import { RECEIVE_KINDS, type Instrument, type ReceiveKind } from '../../../domain/types'
import { RECEIVE_KIND_LABELS } from '../../labels'
import { changeMarket, pickSymbol, type Draft } from '../../transactionDraft'
import { InstrumentFields } from './InstrumentFields'

export function ReceiveFields({
  draft,
  instruments,
  hint,
  setDraft,
}: {
  draft: Draft
  instruments: readonly Instrument[]
  hint?: string
  setDraft(change: (d: Draft) => Draft): void
}) {
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <>
      <Field id="tx-receive-kind" label="ประเภท">
        <NativeSelect id="tx-receive-kind" value={draft.receiveKind} onChange={(e) => update({ receiveKind: e.target.value as ReceiveKind })}>
          {RECEIVE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {RECEIVE_KIND_LABELS[kind]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <InstrumentFields
        idPrefix="tx"
        symbolLabel="สัญลักษณ์"
        market={draft.market}
        symbol={draft.symbol}
        name={draft.instrumentName}
        assetType={draft.assetType}
        instruments={instruments}
        hint={hint}
        onMarket={(market) => setDraft((d) => changeMarket(d, market, instruments))}
        onSymbol={(symbol) => setDraft((d) => pickSymbol(d, symbol, instruments))}
        onName={(instrumentName) => update({ instrumentName })}
        onAssetType={(assetType) => update({ assetType })}
      />
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field id="tx-quantity" label="จำนวนที่ได้รับ">
          <Input id="tx-quantity" inputMode="decimal" value={draft.quantity} onChange={(e) => update({ quantity: e.target.value })} />
        </Field>
        <Field id="tx-price" label="มูลค่าต่อหน่วย ณ วันที่ได้รับ">
          <Input id="tx-price" inputMode="decimal" value={draft.price} onChange={(e) => update({ price: e.target.value })} />
        </Field>
      </div>
    </>
  )
}

// Shown in the row of the currency it is paid in, so the page places it.
export function ReceiveTaxField({ draft, update }: { draft: Draft; update(patch: Partial<Draft>): void }) {
  return (
    <Field id="tx-tax" label="ภาษีหัก ณ ที่จ่าย">
      <Input id="tx-tax" inputMode="decimal" placeholder="0" value={draft.tax} onChange={(e) => update({ tax: e.target.value })} />
    </Field>
  )
}
