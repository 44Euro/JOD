import { ArrowLeftRight, Briefcase, ChartLine, Coins, Ellipsis, House, List, Settings, Target, Upload, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const HOME: NavItem = { to: '/', label: 'ภาพรวม', icon: House }
export const PORTFOLIO: NavItem = { to: '/portfolio', label: 'พอร์ต', icon: Briefcase }
export const TRANSACTIONS: NavItem = { to: '/transactions', label: 'รายการ', icon: List }
export const TRADES: NavItem = { to: '/trades', label: 'เทรด', icon: ChartLine }
export const PLANS: NavItem = { to: '/plans', label: 'แผน', icon: Target }
export const INCOME: NavItem = { to: '/income', label: 'รายได้', icon: Coins }
export const FX: NavItem = { to: '/fx', label: 'ค่าเงิน', icon: ArrowLeftRight }
export const IMPORT: NavItem = { to: '/import', label: 'นำเข้าข้อมูล', icon: Upload }
export const SETTINGS: NavItem = { to: '/settings', label: 'ตั้งค่า', icon: Settings }
export const MORE: NavItem = { to: '/more', label: 'เพิ่มเติม', icon: Ellipsis }
export const NEW_TRANSACTION = '/transactions/new'

export const SIDEBAR_PAGES: readonly NavItem[] = [HOME, PORTFOLIO, TRANSACTIONS, TRADES, PLANS, INCOME, FX, IMPORT, SETTINGS]

// Pages that sit behind "เพิ่มเติม" in the phone tab bar.
export const MORE_PAGES: readonly NavItem[] = [TRANSACTIONS, PLANS, INCOME, FX, IMPORT, SETTINGS]

function isUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function isTransactionEdit(pathname: string): boolean {
  return pathname.startsWith(`${TRANSACTIONS.to}/`) && !isUnder(pathname, NEW_TRANSACTION)
}

// A transaction being edited still belongs to "เพิ่มเติม"; a new one belongs to the ＋ button.
export function isMoreTab(pathname: string): boolean {
  if (isUnder(pathname, NEW_TRANSACTION)) return false
  return isUnder(pathname, MORE.to) || MORE_PAGES.some((page) => isUnder(pathname, page.to))
}

// The list link stays quiet on /transactions/new, which has its own button.
export function isExactLink(to: string): boolean {
  return to === '/' || to === '/transactions'
}

// Instrument ids contain ":" and fund symbols can contain "&", so the id is encoded into one path segment.
export function assetPath(instrumentId: string): string {
  return `/assets/${encodeURIComponent(instrumentId)}`
}
