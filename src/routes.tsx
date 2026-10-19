import type { RouteObject } from 'react-router'
import { Layout } from './ui/Layout'
import { AssetPage } from './ui/pages/AssetPage'
import { DashboardPage } from './ui/pages/DashboardPage'
import { IncomePage } from './ui/pages/IncomePage'
import { MorePage } from './ui/pages/MorePage'
import { PortfolioPage } from './ui/pages/PortfolioPage'
import { SettingsPage } from './ui/pages/SettingsPage'
import { TradesPage } from './ui/pages/TradesPage'
import { TransactionFormPage } from './ui/pages/TransactionFormPage'
import { TransactionsPage } from './ui/pages/TransactionsPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'portfolio', element: <PortfolioPage /> },
      { path: 'assets/:id', element: <AssetPage /> },
      { path: 'income', element: <IncomePage /> },
      { path: 'trades', element: <TradesPage /> },
      { path: 'more', element: <MorePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'transactions/new', element: <TransactionFormPage /> },
      { path: 'transactions/:id', element: <TransactionFormPage /> },
    ],
  },
]
