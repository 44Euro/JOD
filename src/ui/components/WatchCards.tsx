import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { buttonVariants } from '../../components/ui/button-variants'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input, NativeSelect } from '../../components/ui/input'
import { db } from '../../db/db'
import { deleteWatchItem, newId, saveSettings, saveWatchItem } from '../../db/repo'
import { D, parseDecimalInput } from '../../domain/decimal'
import { instrumentKey, MARKETS, type Market } from '../../domain/types'
import { fmtPrice } from '../format'
import type { AppData } from '../hooks'
import { MARKET_LABELS } from '../labels'
import { assetPath } from '../nav'
import { AlertList } from './Alerts'
import { MarketPill } from './MarketPill'
import { t } from '../../i18n'

export function WatchlistCard({ data }: { data: AppData }) {
  const items = useLiveQuery(() => db.watchlist.orderBy('symbol').toArray(), [])
  const [market, setMarket] = useState<Market>('US')
  const [symbol, setSymbol] = useState('')
  const [buyBelow, setBuyBelow] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function add(event: FormEvent) {
    event.preventDefault()
    try {
      const price = buyBelow.trim() ? (parseDecimalInput(buyBelow) ?? buyBelow) : undefined
      await saveWatchItem(db, { id: newId(), market, symbol, note: note.trim(), buyBelow: price, createdAt: new Date().toISOString() })
      setSymbol('')
      setBuyBelow('')
      setNote('')
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('ติดตาม (watchlist)')}</h2>
      {items && items.length > 0 && (
        <ul aria-label={t('สินทรัพย์ที่ติดตาม')}>
          {items.map((item) => {
            const instrument = data.instruments.find((i) => i.id === instrumentKey(item.market, item.symbol))
            const price = instrument?.lastPrice
            const reached = price && item.buyBelow && D(price).lte(item.buyBelow)
            return (
              <li key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-t border-muted py-3 first:border-t-0">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <MarketPill market={item.market} />
                  <b className="font-display">{item.symbol}</b>
                  {reached && <Badge variant="ok">{t('ถึงราคาที่อยากซื้อ')}</Badge>}
                </span>
                <span className="flex items-center">
                  <Link
                    to={`${assetPath(instrumentKey(item.market, item.symbol))}?alert=1`}
                    aria-label={t('ตั้งแจ้งเตือน {0}', item.symbol)}
                    className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                  >
                    <Bell aria-hidden />
                  </Link>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('เลิกติดตาม {0}', item.symbol)} onClick={() => void deleteWatchItem(db, item.id)}>
                    <Trash2 aria-hidden />
                  </Button>
                </span>
                <span className="col-span-2 text-[13px] text-muted-foreground">
                  {[price && t('ล่าสุด {0}', fmtPrice(price)), item.buyBelow && t('อยากซื้อต่ำกว่า {0}', fmtPrice(item.buyBelow)), item.note].filter(Boolean).join(' · ') ||
                    t('ยังไม่มีราคา')}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {(data.settings.alerts ?? []).some((a) => !a.firedAt) && (
        <div className="border-t pt-3">
          <h3 className="mb-1 text-[13.5px] font-semibold text-muted-foreground">{t('แจ้งเตือนราคา')}</h3>
          <AlertList alerts={data.settings.alerts ?? []} settings={data.settings} />
        </div>
      )}
      <form onSubmit={(e) => void add(e)} className="grid gap-3 border-t pt-4 sm:grid-cols-3">
        <Field id="watch-market" label={t('ตลาด')}>
          <NativeSelect id="watch-market" value={market} onChange={(e) => setMarket(e.target.value as Market)}>
            {MARKETS.map((m) => (
              <option key={m} value={m}>
                {MARKET_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="watch-symbol" label={t('สัญลักษณ์')}>
          <Input id="watch-symbol" className="uppercase" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </Field>
        <Field id="watch-below" label={t('อยากซื้อต่ำกว่า (ไม่บังคับ)')}>
          <Input id="watch-below" inputMode="decimal" value={buyBelow} onChange={(e) => setBuyBelow(e.target.value)} />
        </Field>
        <Field id="watch-note" label={t('หมายเหตุ')} className="sm:col-span-3">
          <Input id="watch-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && (
          <Alert tone="error" className="sm:col-span-3">
            {error}
          </Alert>
        )}
        <div className="sm:col-span-3">
          <Button type="submit" disabled={!symbol.trim()}>
            {t('เพิ่มเข้า watchlist')}
          </Button>
        </div>
      </form>
      <p className="text-[12px] text-muted-foreground">{t('ราคาล่าสุดขึ้นเมื่อมีสินทรัพย์นี้ในแอปและอัปเดตราคาแล้ว')}</p>
    </Card>
  )
}

export function ChecklistCard({ data }: { data: AppData }) {
  const items = data.settings.checklist ?? []
  const [draft, setDraft] = useState('')
  const save = (next: string[]) => saveSettings(db, { ...data.settings, checklist: next.length > 0 ? next : undefined })
  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('เช็คลิสต์ก่อนเข้าเทรด')}</h2>
        <p className="text-[12.5px] text-muted-foreground">{t('ขึ้นให้ติ๊กตอนบันทึกการซื้อ ข้อที่ติ๊กเก็บไว้ในบันทึกเทรด')}</p>
      </div>
      {items.length > 0 && (
        <ol aria-label={t('ข้อในเช็คลิสต์')} className="grid gap-1.5">
          {items.map((item, i) => (
            <li key={`${item}-${i}`} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-sm">
              <span>
                {i + 1}. {item}
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label={t('ลบข้อ {0}', item)} onClick={() => void save(items.filter((_, j) => j !== i))}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const text = draft.trim()
          if (!text || items.includes(text)) return
          void save([...items, text])
          setDraft('')
        }}
      >
        <Field id="checklist-item" label={t('เพิ่มข้อ')}>
          <Input id="checklist-item" placeholder={t('เช่น ตามแผนที่เขียนไว้, ตั้ง Stop loss แล้ว')} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <Button type="submit" variant="outline" className="h-[46px]" disabled={!draft.trim()}>
          {t('เพิ่ม')}
        </Button>
      </form>
    </Card>
  )
}
