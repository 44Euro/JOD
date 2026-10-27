import { ArrowLeftRight, Briefcase, ChartLine, Coins, Ellipsis, FileText, House, List, Newspaper, Receipt, Settings, Target, Upload, type LucideIcon } from 'lucide-react'
import { instrumentKey } from '../domain/types'
import type { FoundAsset } from '../market/client'
import { t } from '../i18n'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const HOME: NavItem = { to: '/', label: t('เช้านี้'), icon: House }
export const MARKET: NavItem = { to: '/market', label: t('ตลาด'), icon: Newspaper }
export const PORTFOLIO: NavItem = { to: '/portfolio', label: t('พอร์ต'), icon: Briefcase }
export const TRANSACTIONS: NavItem = { to: '/transactions', label: t('รายการ'), icon: List }
export const TRADES: NavItem = { to: '/trades', label: t('เทรด'), icon: ChartLine }
export const PLANS: NavItem = { to: '/plans', label: t('แผน'), icon: Target }
export const SUMMARY: NavItem = { to: '/summary', label: t('สรุปประจำปี'), icon: FileText }
export const TAX: NavItem = { to: '/tax', label: t('ช่วยเตรียมภาษี'), icon: Receipt }
export const INCOME: NavItem = { to: '/income', label: t('รายได้'), icon: Coins }
export const FX: NavItem = { to: '/fx', label: t('ค่าเงิน'), icon: ArrowLeftRight }
export const IMPORT: NavItem = { to: '/import', label: t('นำเข้าข้อมูล'), icon: Upload }
export const SETTINGS: NavItem = { to: '/settings', label: t('ตั้งค่า'), icon: Settings }
export const MORE: NavItem = { to: '/more', label: t('เพิ่มเติม'), icon: Ellipsis }
export const NEW_TRANSACTION = '/transactions/new'

export const SIDEBAR_PAGES: readonly NavItem[] = [HOME, MARKET, PORTFOLIO, TRANSACTIONS, TRADES, PLANS, INCOME, SUMMARY, FX, IMPORT, SETTINGS]

// Pages that sit behind "เพิ่มเติม" in the phone tab bar.
export const MORE_PAGES: readonly NavItem[] = [TRANSACTIONS, PLANS, INCOME, SUMMARY, TAX, FX, IMPORT, SETTINGS]

function isUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

// On a phone เทรด lives inside พอร์ต, so the พอร์ต tab stands for holdings, asset pages and trades.
export function isPortfolioTab(pathname: string): boolean {
  return [PORTFOLIO.to, TRADES.to, '/assets'].some((to) => isUnder(pathname, to))
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

export function foundPath(found: FoundAsset): string {
  return assetPath(instrumentKey(found.market, found.symbol))
}

// A buy of an asset the app does not know yet, its details carried in the address for the form to fill in.
export function buyPath(found: FoundAsset): string {
  const { market, symbol, name, assetType } = found
  return `/transactions/new?${new URLSearchParams({ type: 'buy', market, symbol, name, assetType })}`
}
