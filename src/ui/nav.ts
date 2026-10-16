import { Briefcase, Coins, Ellipsis, House, List, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const HOME: NavItem = { to: '/', label: 'ภาพรวม', icon: House }
export const PORTFOLIO: NavItem = { to: '/portfolio', label: 'พอร์ต', icon: Briefcase }
export const TRANSACTIONS: NavItem = { to: '/transactions', label: 'รายการ', icon: List }
export const INCOME: NavItem = { to: '/income', label: 'รายได้', icon: Coins }
export const SETTINGS: NavItem = { to: '/settings', label: 'ตั้งค่า', icon: Settings }
export const MORE: NavItem = { to: '/more', label: 'เพิ่มเติม', icon: Ellipsis }
export const NEW_TRANSACTION = '/transactions/new'

export const SIDEBAR_PAGES: readonly NavItem[] = [HOME, PORTFOLIO, TRANSACTIONS, INCOME, SETTINGS]

// Pages that sit behind "เพิ่มเติม" in the phone tab bar.
export const MORE_PAGES: readonly NavItem[] = [INCOME, SETTINGS]

// The list link stays quiet on /transactions/new, which has its own button.
export function isExactLink(to: string): boolean {
  return to === '/' || to === '/transactions'
}

// Instrument ids contain ":" and fund symbols can contain "&", so the id is encoded into one path segment.
export function assetPath(instrumentId: string): string {
  return `/assets/${encodeURIComponent(instrumentId)}`
}
