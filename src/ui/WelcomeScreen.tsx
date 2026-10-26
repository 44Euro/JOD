import { LockKeyhole } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n'
import { cn } from '../lib/cn'
import { ThemeSync, useBoardStatusBar } from './theme'
import { markWelcomed } from './welcome'

function Ticker({ name, price, change, up }: { name: string; price: string; change: string; up: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 border-b border-board-line py-3 last:border-0">
      <span className="text-[15px] font-semibold text-white">{name}</span>
      <span className="font-mono text-[15px] text-white tabular-nums">{price}</span>
      <span className={cn('w-14 text-right font-mono text-[13px] tabular-nums', up ? 'text-board-gain' : 'text-board-loss')}>{change}</span>
    </div>
  )
}

function RateBoard() {
  return (
    <div className="w-full max-w-[300px] rounded-2xl border border-board-line bg-[color-mix(in_oklab,var(--board-line)_45%,var(--board))] px-5 py-2 shadow-[0_24px_48px_-20px_rgb(0_0_0/0.6)]">
      <p className="flex justify-between border-b border-board-line pt-2 pb-2.5 text-[12px] text-board-muted">
        <span>{t('กระดานเรท')}</span>
        <span>{t('ราคาตัวอย่าง')}</span>
      </p>
      <Ticker name="PTT" price="34.25" change="+1.5%" up />
      <Ticker name="AAPL" price="228.40" change="+0.8%" up />
      <Ticker name="BTC" price="2.31M" change="−2.1%" up={false} />
      <Ticker name={t('กองทุน')} price="18.0412" change="+0.2%" up />
    </div>
  )
}

function Station({ ring, amount, label }: { ring: string; amount: string; label: string }) {
  return (
    <div className="grid grid-cols-[22px_1fr] items-center gap-x-4">
      <span className={cn('size-[22px] rounded-full border-[5px] bg-board', ring)} />
      <span className="font-mono text-[17px] text-white tabular-nums">{amount}</span>
      <span />
      <span className="text-[13px] text-board-muted">{label}</span>
    </div>
  )
}

function MoneyRoute() {
  return (
    <div className="relative grid gap-7">
      <span aria-hidden className="absolute top-3 bottom-[34px] left-[8.5px] w-[5px] rounded-full bg-[linear-gradient(var(--board-muted),var(--board-mine))]" />
      <Station ring="border-white" amount="฿100,000" label={t('เงินสด')} />
      <Station ring="border-board-fx" amount="@ 34.10" label={t('แลกเป็นดอลลาร์')} />
      <Station ring="border-white" amount="$2,932.55" label={t('ซื้อหุ้นสหรัฐ')} />
    </div>
  )
}

function PinLock() {
  return (
    <div className="grid justify-items-center gap-7">
      <span className="grid size-24 place-items-center rounded-full border border-board-line bg-[color-mix(in_oklab,var(--board-line)_45%,var(--board))]">
        <LockKeyhole className="size-10 text-white" strokeWidth={1.75} />
      </span>
      <span className="flex gap-3.5">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={cn('size-3.5 rounded-full', i < 4 ? 'bg-white' : 'border-2 border-board-muted')} />
        ))}
      </span>
    </div>
  )
}

const SLIDES: { title: string; body: string; art: ReactNode }[] = [
  {
    title: t('จดทุกเทรด รู้ทุกบาท'),
    body: t('หุ้นไทย หุ้นต่างประเทศ กองทุน คริปโต และเงินสด บันทึกไว้ที่เดียว'),
    art: <RateBoard />,
  },
  {
    title: t('เห็นเส้นทางเงินทุกสกุล'),
    body: t('แลกเงินที่เรทเท่าไร กำไรจริงเป็นบาทเท่าไร ดูได้ทุกรายการ'),
    art: <MoneyRoute />,
  },
  {
    title: t('ข้อมูลเป็นของคุณ'),
    body: t('เข้ารหัสด้วยรหัสผ่านของคุณก่อนซิงก์ และเปิดแอปด้วย PIN 6 หลัก'),
    art: <PinLock />,
  },
]

export function WelcomeScreen({ onChoose }: { onChoose: (mode: 'login' | 'signup') => void }) {
  useBoardStatusBar()
  const track = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)

  function choose(mode: 'login' | 'signup') {
    markWelcomed()
    onChoose(mode)
  }

  function goTo(index: number) {
    const el = track.current
    if (el) el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col bg-board pb-[max(env(safe-area-inset-bottom),24px)] text-white">
      <ThemeSync />
      <p className="px-6 pt-6 font-display text-[22px] leading-none font-semibold tracking-[-0.01em] md:px-10">JOD</p>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div
          ref={track}
          className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        >
          {SLIDES.map((slide, i) => (
            <section
              key={slide.title}
              aria-hidden={i !== page}
              className="grid w-full shrink-0 snap-center grid-rows-[1fr_auto] gap-10 px-6 pt-6"
            >
              <div className="grid place-items-center">{slide.art}</div>
              <div>
                <h1 className="font-display text-[30px] leading-[1.15] font-semibold text-balance">{slide.title}</h1>
                <p className="mt-3 text-[15.5px] leading-relaxed text-board-muted text-pretty">{slide.body}</p>
              </div>
            </section>
          ))}
        </div>
        <div className="flex gap-2 px-6 pt-7 pb-8">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              aria-label={t('หน้า {0} จาก {1}', i + 1, SLIDES.length)}
              aria-current={i === page}
              className={cn('h-2 rounded-full transition-[width,background-color] duration-300', i === page ? 'w-7 bg-board-mine' : 'w-2 bg-board-muted/45 hover:bg-board-muted')}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
        <div className="grid gap-3 px-6">
          <button
            type="button"
            className="h-13 rounded-2xl bg-white text-base font-semibold text-board transition-colors hover:bg-board-mine focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60"
            onClick={() => choose('signup')}
          >
            {t('สมัครบัญชี')}
          </button>
          <button
            type="button"
            className="h-13 rounded-2xl border border-board-muted/50 text-base font-semibold text-white transition-colors hover:bg-board-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-board-mine/60"
            onClick={() => choose('login')}
          >
            {t('มีบัญชีแล้ว เข้าสู่ระบบ')}
          </button>
        </div>
      </main>
    </div>
  )
}
