import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { D } from '../../domain/decimal'
import type { BigMoney, BigMoneyFor, CongressTrade, FundMove, Insider } from '../../market/client'
import { cn } from '../../lib/cn'
import { fmtCompact, fmtDate } from '../format'
import { assetPath } from '../nav'
import type { MarketState } from '../useMarket'
import { MarketCard } from './MarketCard'
import { MarketPill } from './MarketPill'
import { MarketNote } from './NewsList'
import { t } from '../../i18n'

const SHOWN = 4
export const CONGRESS_DELAY = t('รายงานของสภาผู้แทนฯ ช้าได้ 30–45 วันตามกฎหมาย')
const FUND_ACTIONS = { new: t('ซื้อใหม่'), add: t('ซื้อเพิ่ม'), reduce: t('ขายบางส่วน'), exit: t('ขายหมด'), same: t('ถือเท่าเดิม') }
const HOUSE_ACTIONS = { buy: t('ซื้อ'), sell: t('ขาย'), partial: t('ขายบางส่วน'), exchange: t('แลกเปลี่ยน') }

// Buying is signed + in the gain colour and selling − in the loss colour, as changes are everywhere in JOD.
function action(sign: '+' | '−' | '', text: string) {
  return { text: sign ? `${sign} ${text}` : text, tone: sign === '+' ? 'text-gain' : sign === '−' ? 'text-loss' : 'text-ink-2' }
}

export function fundAction(move: FundMove) {
  if (move.change === 'same') return action('', FUND_ACTIONS.same)
  const sign = move.change === 'new' || move.change === 'add' ? '+' : '−'
  return action(sign, `${FUND_ACTIONS[move.change]} ${fmtCompact(String(Math.abs(Number(move.sharesChange))))} ${t('หุ้น')}`)
}

export function houseAction(trade: CongressTrade) {
  return action(trade.type === 'buy' ? '+' : trade.type === 'exchange' ? '' : '−', `${HOUSE_ACTIONS[trade.type]} ${trade.amount}`)
}

function insiderAction(trade: Insider) {
  const shares = Number(trade.shares).toLocaleString('en-US', { maximumFractionDigits: 4 })
  return action(trade.side === 'buy' ? '+' : '−', `${HOUSE_ACTIONS[trade.side]} ${shares} ${t('หุ้น')} @ ${D(trade.price || 0).toFixed(2)}`)
}

export function Row({ label, symbol, actor, act, meta, link = true }: { label: string; symbol: ReactNode; actor: string; act: { text: string; tone: string }; meta: ReactNode; link?: boolean }) {
  return (
    <li aria-label={label} className="grid gap-0.5 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          {typeof symbol === 'string' && link ? (
            <Link to={assetPath(`US:${symbol}`)} className="inline-flex items-center gap-1.5 font-display font-semibold hover:underline">
              <MarketPill market="US" />
              {symbol}
            </Link>
          ) : (
            symbol
          )}
          <span className="min-w-0 truncate text-[13px] text-ink-2">{actor}</span>
        </span>
        <span className={cn('font-display text-[14px] font-semibold', act.tone)}>{act.text}</span>
      </div>
      <p className="text-[13px] text-muted-foreground">{meta}</p>
    </li>
  )
}

const fundMeta = (period: string, filedAt: string) => t('13F ไตรมาส {0} · ยื่น {1}', fmtDate(period), fmtDate(filedAt))

export function CongressRow({ trade, link = true }: { trade: CongressTrade; link?: boolean }) {
  return (
    <Row
      label={`${trade.ticker} ${trade.member}`}
      symbol={trade.ticker}
      link={link}
      actor={`${trade.member} · ${trade.state}`}
      act={houseAction(trade)}
      meta={
        <>
          {t('ซื้อขาย {0} · แจ้ง {1}', fmtDate(trade.tradedAt), fmtDate(trade.notifiedAt))}
          {' · '}
          <a href={trade.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-[3px]">
            {t('รายงาน')}
          </a>
        </>
      }
    />
  )
}

export function FundRow({ fund, period, filedAt, move }: { fund: string; period: string; filedAt: string; move: FundMove }) {
  return (
    <Row
      label={`${move.ticker ?? move.issuer} ${fund}`}
      symbol={move.ticker ?? <b className="font-display font-semibold">{move.issuer}</b>}
      actor={fund}
      act={fundAction(move)}
      meta={fundMeta(period, filedAt)}
    />
  )
}

const BIG_MONEY_SOURCE = t('ที่มา SEC (13F) · สภาผู้แทนฯ สหรัฐ')

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mt-1 mb-2 text-[13px] font-semibold text-muted-foreground">{children}</h3>
}

// ตลาด's look at the big money: the newest moves of the followed funds, then what House members traded.
export function BigMoneySection({ state }: { state: MarketState<BigMoney> }) {
  return (
    <MarketCard title={t('เงินใหญ่ขยับ')} more="/market/bigmoney" source={BIG_MONEY_SOURCE}>
      {state.status !== 'ready' ? (
        <MarketNote state={state} />
      ) : (
        <div className="grid gap-2">
          <Heading>{t('กองทุนใหญ่ · 13F')}</Heading>
          <FundMoves funds={state.data.funds} limit={SHOWN} />
          <Heading>{t('สภาผู้แทนฯ สหรัฐ')}</Heading>
          <CongressTrades trades={state.data.congress} limit={SHOWN} />
        </div>
      )}
    </MarketCard>
  )
}

export function FundMoves({ funds, limit }: { funds: BigMoney['funds']; limit?: number }) {
  if (funds === null) return <p className="text-[13px] text-muted-foreground">{t('ข้อมูล 13F ยังไม่เปิด: เซิร์ฟเวอร์ยังไม่ได้ตั้ง SEC_USER_AGENT')}</p>
  const moves = [...funds].sort((a, b) => b.filedAt.localeCompare(a.filedAt)).flatMap((f) => f.moves.map((move) => ({ f, move })))
  if (moves.length === 0) return <p className="text-[13px] text-muted-foreground">{t('ยังไม่มีการเปลี่ยนแปลงใน 13F ล่าสุด')}</p>
  return (
    <ul>
      {moves.slice(0, limit).map(({ f, move }) => (
        <FundRow key={`${f.cik}:${move.issuer}`} fund={f.name} period={f.period} filedAt={f.filedAt} move={move} />
      ))}
    </ul>
  )
}

// One report often lists many trades; a short list shows each member's newest trade before anyone's second.
function spread(trades: readonly CongressTrade[]): CongressTrade[] {
  const firsts = trades.filter((trade, i) => trades.findIndex((t) => t.member === trade.member) === i)
  return [...firsts, ...trades.filter((trade) => !firsts.includes(trade))]
}

export function CongressTrades({ trades, limit }: { trades: BigMoney['congress']; limit?: number }) {
  if (trades === null) return <p className="text-[13px] text-muted-foreground">{t('ดึงรายงานสภาผู้แทนฯ ไม่ได้ตอนนี้')}</p>
  if (trades.length === 0) return <p className="text-[13px] text-muted-foreground">{t('ยังไม่มีรายงานการซื้อขายหุ้น')}</p>
  return (
    <>
      <ul>
        {(limit ? spread(trades).slice(0, limit) : trades).map((trade, i) => (
          <CongressRow key={`${trade.url}:${i}`} trade={trade} />
        ))}
      </ul>
      <p className="text-[13px] text-muted-foreground">{CONGRESS_DELAY}</p>
    </>
  )
}

// The stock page's section: who among the followed funds, the company's insiders and House members traded it.
export function StockBigMoney({ data }: { data: BigMoneyFor }) {
  const holders = data.holders ?? []
  const insiders = data.insiders ?? []
  if (holders.length === 0 && insiders.length === 0 && data.congress.length === 0) return null
  return (
    <MarketCard title={t('เงินใหญ่')} source={t('ที่มา SEC (13F, Form 4) · สภาผู้แทนฯ สหรัฐ')}>
      <div className="grid gap-2">
        {holders.length > 0 && (
          <>
            <Heading>{t('กองทุนที่ถือ · 13F')}</Heading>
            <ul>
              {holders.map((h) => (
                <Row key={h.fund} label={h.fund} symbol={null} actor={h.fund} act={fundAction(h)} meta={`${t('ถือ {0} หุ้น', fmtCompact(h.shares))} · ${fundMeta(h.period, h.filedAt)}`} />
              ))}
            </ul>
          </>
        )}
        {insiders.length > 0 && (
          <>
            <Heading>{t('ผู้บริหารซื้อขาย · Form 4')}</Heading>
            <ul>
              {insiders.map((trade, i) => (
                <Row
                  key={`${trade.owner}:${trade.date}:${i}`}
                  label={trade.owner}
                  symbol={null}
                  actor={[trade.owner, trade.role].filter(Boolean).join(' · ')}
                  act={insiderAction(trade)}
                  meta={`${t('ซื้อขาย {0}', fmtDate(trade.date))} · ${t('Form 4 · ยื่น {0}', fmtDate(trade.filedAt))}`}
                />
              ))}
            </ul>
          </>
        )}
        {data.congress.length > 0 && (
          <>
            <Heading>{t('สภาผู้แทนฯ สหรัฐ')}</Heading>
            <ul>
              {data.congress.map((trade, i) => (
                <CongressRow key={`${trade.url}:${i}`} trade={trade} link={false} />
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">{CONGRESS_DELAY}</p>
          </>
        )}
      </div>
    </MarketCard>
  )
}
