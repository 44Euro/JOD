import { Plus } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { buttonVariants } from '../components/ui/button'
import { cn } from '../lib/cn'
import { DailyValueRecorder } from './DailyValueRecorder'
import { HOME, MORE, MORE_PAGES, NEW_TRANSACTION, PORTFOLIO, SIDEBAR_PAGES, TRANSACTIONS, isExactLink, type NavItem } from './nav'

const LEGEND = [
  { label: 'หุ้นสหรัฐ', className: 'bg-market-us' },
  { label: 'หุ้นไทย', className: 'bg-market-set' },
  { label: 'ตลาดต่างประเทศอื่น', className: 'bg-market-intl' },
  { label: 'คริปโต', className: 'bg-market-crypto' },
  { label: 'กองทุน', className: 'bg-market-fund' },
  { label: 'ผลจากค่าเงิน', className: 'bg-fx' },
]

const SIDE_CLASS = 'flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15.5px] text-ink-2 hover:bg-muted'
const SIDE_ACTIVE_CLASS = 'bg-primary-soft font-semibold text-primary-ink hover:bg-primary-soft'

// NavLink only marks aria-current for its own route, so a link that also stands for other pages is a plain Link.
function SideLink({ to, label, icon: Icon, active }: NavItem & { active?: boolean }) {
  const content = (
    <>
      <Icon className="size-5" aria-hidden />
      {label}
    </>
  )
  if (active) {
    return (
      <Link to={to} aria-current="page" className={cn(SIDE_CLASS, SIDE_ACTIVE_CLASS)}>
        {content}
      </Link>
    )
  }
  return (
    <NavLink to={to} end={isExactLink(to)} className={({ isActive }) => cn(SIDE_CLASS, isActive && SIDE_ACTIVE_CLASS)}>
      {content}
    </NavLink>
  )
}

const TAB_CLASS = 'flex min-h-12 flex-col items-center justify-end gap-0.5 text-[11px] text-muted-foreground'
const TAB_ACTIVE_CLASS = 'font-semibold text-primary'

// NavLink only marks aria-current for its own route, so a tab that stands for several pages is a plain Link.
function TabLink({ to, label, icon: Icon, active }: NavItem & { active?: boolean }) {
  const content = (
    <>
      <Icon className="size-[22px]" aria-hidden />
      {label}
    </>
  )
  if (active) {
    return (
      <Link to={to} aria-current="page" className={cn(TAB_CLASS, TAB_ACTIVE_CLASS)}>
        {content}
      </Link>
    )
  }
  return (
    <NavLink to={to} end={isExactLink(to)} className={({ isActive }) => cn(TAB_CLASS, isActive && TAB_ACTIVE_CLASS)}>
      {content}
    </NavLink>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const inMore = MORE_PAGES.some((page) => pathname.startsWith(page.to))
  const inAssets = pathname.startsWith('/assets/')
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <DailyValueRecorder />
      <aside className="sticky top-0 hidden h-dvh flex-col gap-0.5 overflow-y-auto border-r bg-card px-4 py-[26px] md:flex">
        <p className="px-2 font-display text-[30px] font-semibold leading-none">
          JOD
          <span className="mt-1 block font-sans text-xs font-normal text-muted-foreground">จดทุกเทรด รู้ทุกบาท</span>
        </p>
        <NavLink to={NEW_TRANSACTION} className={cn(buttonVariants(), 'mt-[22px] mb-4 h-12 text-base md:h-12')}>
          <Plus aria-hidden />
          บันทึกรายการ
        </NavLink>
        <nav aria-label="เมนูหลัก" className="grid gap-0.5">
          {SIDEBAR_PAGES.map((item) => (
            <SideLink key={item.to} {...item} active={item.to === PORTFOLIO.to && inAssets} />
          ))}
        </nav>
        <div className="mt-auto grid gap-[7px] border-t px-2.5 pt-3.5 text-[12.5px] text-muted-foreground">
          <p className="font-semibold text-ink-2">สีประจำตลาด</p>
          {LEGEND.map((item) => (
            <p key={item.label} className="flex items-center gap-2.5">
              <span aria-hidden className={cn('h-1.5 w-6 rounded-full', item.className)} />
              {item.label}
            </p>
          ))}
        </div>
      </aside>
      <main className="min-w-0 px-4 pt-3.5 pb-[calc(112px+env(safe-area-inset-bottom))] md:px-11 md:pt-[30px] md:pb-16">
        <div className="mx-auto grid max-w-[1240px] content-start gap-3.5 md:gap-[22px] [&>*]:min-w-0">
          <Outlet />
        </div>
      </main>
      <nav
        aria-label="เมนูด้านล่าง"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 items-end border-t bg-card pt-1.5 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden"
      >
        <TabLink {...HOME} />
        <TabLink {...PORTFOLIO} active={inAssets} />
        <NavLink to={NEW_TRANSACTION} className="flex flex-col items-center gap-0.5 text-[11px] text-muted-foreground">
          <span className="-mt-5 grid size-[54px] place-items-center rounded-[17px] bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(29,78,216,.3)]">
            <Plus className="size-6" aria-hidden />
          </span>
          บันทึก
        </NavLink>
        <TabLink {...TRANSACTIONS} />
        <TabLink {...MORE} active={inMore} />
      </nav>
    </div>
  )
}
