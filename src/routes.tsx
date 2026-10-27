import type { RouteObject } from 'react-router'
import { AuthGate } from './ui/AuthGate'
import { Layout } from './ui/Layout'
import { AssetPage } from './ui/pages/AssetPage'
import { DashboardPage } from './ui/pages/DashboardPage'
import { ErrorPage } from './ui/pages/ErrorPage'
import { IncomePage } from './ui/pages/IncomePage'
import { MarketPage } from './ui/pages/MarketPage'
import { MorePage } from './ui/pages/MorePage'
import { PortfolioPage } from './ui/pages/PortfolioPage'
import { SettingsPage } from './ui/pages/SettingsPage'
import { TradesPage } from './ui/pages/TradesPage'
import { TransactionFormPage } from './ui/pages/TransactionFormPage'
import { TransactionsPage } from './ui/pages/TransactionsPage'
import { WelcomePage } from './ui/pages/WelcomePage'

export const routes: RouteObject[] = [
  {
    element: <AuthGate />,
    errorElement: <ErrorPage />,
    children: [
      { path: '/welcome', element: <WelcomePage /> },
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'market', element: <MarketPage /> },
          { path: 'portfolio', element: <PortfolioPage /> },
          { path: 'assets/:id', element: <AssetPage /> },
          { path: 'plans', lazy: async () => ({ Component: (await import('./ui/pages/PlansPage')).PlansPage }) },
          { path: 'income', element: <IncomePage /> },
          { path: 'summary', lazy: async () => ({ Component: (await import('./ui/pages/SummaryPage')).SummaryPage }) },
          { path: 'tax', lazy: async () => ({ Component: (await import('./ui/pages/TaxPage')).TaxPage }) },
          { path: 'trades', element: <TradesPage /> },
          { path: 'fx', lazy: async () => ({ Component: (await import('./ui/pages/FxPage')).FxPage }) },
          { path: 'import', lazy: async () => ({ Component: (await import('./ui/pages/ImportPage')).ImportPage }) },
          { path: 'more', element: <MorePage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'privacy', lazy: async () => ({ Component: (await import('./ui/pages/PrivacyPage')).PrivacyPage }) },
          { path: 'transactions', element: <TransactionsPage /> },
          { path: 'transactions/new', element: <TransactionFormPage /> },
          { path: 'transactions/:id', element: <TransactionFormPage /> },
        ],
      },
    ],
  },
]
