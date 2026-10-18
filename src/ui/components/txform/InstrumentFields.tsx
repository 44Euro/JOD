import { Field } from '../../../components/ui/field'
import { Input, NativeSelect } from '../../../components/ui/input'
import { ASSET_TYPES, MARKETS, findInstrument, type AssetType, type Instrument, type Market } from '../../../domain/types'
import { ASSET_TYPE_LABELS, MARKET_LABELS } from '../../labels'

export interface InstrumentFieldsProps {
  idPrefix: string
  symbolLabel: string
  market: Market
  symbol: string
  name: string
  assetType: AssetType
  instruments: readonly Instrument[]
  hint?: string
  allowNew?: boolean
  onMarket(market: Market): void
  onSymbol(symbol: string): void
  onName(name: string): void
  onAssetType(assetType: AssetType): void
}

export function InstrumentFields({
  idPrefix,
  symbolLabel,
  market,
  symbol,
  name,
  assetType,
  instruments,
  hint,
  allowNew = true,
  onMarket,
  onSymbol,
  onName,
  onAssetType,
}: InstrumentFieldsProps) {
  const known = findInstrument(instruments, market, symbol) !== undefined
  const listId = `${idPrefix}-symbols`
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <Field id={`${idPrefix}-market`} label="ตลาด">
        <NativeSelect id={`${idPrefix}-market`} value={market} onChange={(e) => onMarket(e.target.value as Market)}>
          {MARKETS.map((m) => (
            <option key={m} value={m}>
              {MARKET_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${idPrefix}-symbol`} label={symbolLabel} hint={hint}>
        <Input
          id={`${idPrefix}-symbol`}
          list={listId}
          autoCapitalize="characters"
          placeholder="AAPL, PTT, BTC"
          value={symbol}
          onChange={(e) => onSymbol(e.target.value)}
        />
        <datalist id={listId}>
          {instruments
            .filter((i) => i.market === market)
            .map((i) => (
              <option key={i.id} value={i.symbol}>
                {i.name}
              </option>
            ))}
        </datalist>
      </Field>
      {allowNew && !known && (
        <>
          <Field id={`${idPrefix}-name`} label="ชื่อ (ไม่บังคับ)">
            <Input id={`${idPrefix}-name`} value={name} onChange={(e) => onName(e.target.value)} />
          </Field>
          <Field id={`${idPrefix}-asset-type`} label="ประเภทสินทรัพย์">
            <NativeSelect id={`${idPrefix}-asset-type`} value={assetType} onChange={(e) => onAssetType(e.target.value as AssetType)}>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </>
      )}
    </div>
  )
}
