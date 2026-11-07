import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { SEARCH_RECENT_STORAGE_KEY, readLocal, writeLocal } from '../../ai/apiKey'
import { Button } from '../../components/ui/button'
import type { Instrument } from '../../domain/types'
import { marketClient, type FoundAsset, type MarketClient } from '../../market/client'
import { cn } from '../../lib/cn'
import { MARKET_LABELS } from '../labels'
import { MarketPill } from './MarketPill'
import { t } from '../../i18n'

const RECENT_MAX = 5
const DEBOUNCE_MS = 250

const GROUPS = [
  { market: 'US', label: () => t('หุ้น US') },
  { market: 'SET', label: () => t('หุ้นไทย') },
  { market: 'CRYPTO', label: () => t('คริปโต') },
] as const

const same = (a: FoundAsset, b: FoundAsset) => a.market === b.market && a.symbol === b.symbol

function readRecent(): FoundAsset[] {
  try {
    const parsed = JSON.parse(readLocal(SEARCH_RECENT_STORAGE_KEY) || '[]') as unknown
    return Array.isArray(parsed) ? (parsed as FoundAsset[]) : []
  } catch {
    return []
  }
}

function remember(found: FoundAsset) {
  writeLocal(SEARCH_RECENT_STORAGE_KEY, JSON.stringify([found, ...readRecent().filter((r) => !same(r, found))].slice(0, RECENT_MAX)))
}

export interface SearchSheetProps {
  open: boolean
  onClose(): void
  onPick(found: FoundAsset): void
  instruments: readonly Instrument[]
  market?: MarketClient
}

export function SearchSheet(props: SearchSheetProps) {
  return props.open ? <OpenSheet {...props} /> : null
}

// The command-menu search: the app's own assets answer at once, the JOD server's catalog after a short pause.
function OpenSheet({ onClose, onPick, instruments, market = marketClient }: SearchSheetProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; results: FoundAsset[]; failed: boolean } | null>(null)
  const [active, setActive] = useState(0)
  const [recent] = useState(readRecent)
  // Read while rendering, before the input's autoFocus moves the focus into the sheet.
  const [opener] = useState(() => document.activeElement)
  const latest = useRef('')

  useEffect(() => () => (opener as HTMLElement | null)?.focus?.(), [opener])

  const typed = query.trim()
  useEffect(() => {
    latest.current = typed
    if (!typed) return
    const timer = setTimeout(() => {
      market.search(typed).then(
        // An answer to an older query that arrives late must not replace the newer one's.
        (results) => latest.current === typed && setFound({ query: typed, results, failed: false }),
        () => latest.current === typed && setFound({ query: typed, results: [], failed: true }),
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [typed, market])

  const lower = typed.toLowerCase()
  const mine: FoundAsset[] = typed
    ? instruments
        .filter((i) => i.symbol.toLowerCase().includes(lower) || i.name.toLowerCase().includes(lower))
        .map(({ market, symbol, name, assetType }) => ({ market, symbol, name, assetType }))
    : []
  const current = found && found.query === typed ? found : null
  const fromServer = (current?.results ?? []).filter((r) => !mine.some((m) => same(m, r)))
  const groups = typed
    ? [{ label: t('ของฉัน'), items: mine }, ...GROUPS.map((g) => ({ label: g.label(), items: fromServer.filter((r) => r.market === g.market) }))]
    : [{ label: t('ค้นล่าสุด'), items: recent }]
  const shown = groups.filter((g) => g.items.length > 0)
  const options = shown.flatMap((g) => g.items)
  const activeIndex = Math.min(active, options.length - 1)

  function pick(item: FoundAsset) {
    remember(item)
    onPick(item)
    onClose()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length > 0) setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
    } else if (event.key === 'Enter' && options[activeIndex]) {
      event.preventDefault()
      pick(options[activeIndex])
    }
  }

  const status = !typed
    ? recent.length === 0
      ? t('พิมพ์ชื่อหรือสัญลักษณ์ของหุ้น US หุ้นไทย หรือคริปโต')
      : ''
    : current?.failed
      ? t('ค้นหาจากเซิร์ฟเวอร์ไม่ได้ตอนนี้')
      : !current
        ? t('กำลังค้นหา…')
        : options.length === 0
          ? t('ไม่พบ "{0}" พิมพ์สัญลักษณ์เองในฟอร์มได้', typed)
          : ''
  let index = -1

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-[rgb(11_31_58/0.45)] md:items-start md:justify-center md:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('ค้นหาสินทรัพย์')}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="flex max-h-[88dvh] w-full flex-col rounded-t-[28px] bg-card pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-12px_40px_-12px_rgb(11_31_58/0.45)] md:max-h-[70vh] md:max-w-[560px] md:rounded-[20px] md:pb-0 md:shadow-[0_24px_56px_-20px_rgb(11_31_58/0.5)]"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted md:hidden" aria-hidden />
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            role="combobox"
            aria-label={t('ค้นหาสินทรัพย์')}
            aria-expanded={options.length > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={options.length > 0 ? `${id}-option-${activeIndex}` : undefined}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={t('ชื่อหรือสัญลักษณ์ เช่น NVDA, PTT, BTC')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-placeholder focus-visible:outline-none"
          />
          <Button type="button" variant="ghost" size="icon" aria-label={t('ปิด')} onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
        <div id={`${id}-list`} role="listbox" aria-label={t('ผลการค้นหา')} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {shown.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="pb-1">
              <p className="px-3 pt-2 pb-1 text-[13px] font-semibold text-muted-foreground" aria-hidden>
                {group.label}
              </p>
              {group.items.map((item) => {
                index += 1
                const mineIndex = index
                return (
                  <div
                    key={`${item.market}:${item.symbol}`}
                    id={`${id}-option-${mineIndex}`}
                    role="option"
                    aria-selected={mineIndex === activeIndex}
                    aria-label={`${item.symbol} ${item.name} ${MARKET_LABELS[item.market]}`}
                    onMouseMove={() => setActive(mineIndex)}
                    onClick={() => pick(item)}
                    className={cn(
                      'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2',
                      mineIndex === activeIndex && 'bg-primary-soft',
                    )}
                  >
                    <MarketPill market={item.market} assetType={item.assetType} />
                    <span className="font-display text-[15px] font-semibold text-foreground">{item.symbol}</span>
                    <span className="min-w-0 truncate text-[13px] text-muted-foreground">{item.name}</span>
                  </div>
                )
              })}
            </div>
          ))}
          <p role="status" className={cn('px-3 text-[13px] text-muted-foreground', status && 'py-3')}>
            {status}
          </p>
        </div>
        <p className="border-t px-4 py-2.5 text-[12px] text-muted-foreground">{t('รายชื่อจาก Yahoo และ CoinGecko')}</p>
      </div>
    </div>
  )
}
