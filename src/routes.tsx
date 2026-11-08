import type { RouteObject } from 'react-router'
import { AuthGate } from './ui/AuthGate'
import { Layout } from './ui/Layout'
import { DashboardPage } from './ui/pages/DashboardPage'
import { ErrorPage } from './ui/pages/ErrorPage'
import { WelcomePage } from './ui/pages/WelcomePage'

// Every page but the home screen loads when first opened, so the first visit downloads only what it shows.
const transactionForm = async () => ({ Component: (await import('./ui/pages/TransactionFormPage')).TransactionFormPage })

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
          { path: 'market', lazy: async () => ({ Component: (await import('./ui/pages/MarketPage')).MarketPage }) },
          { path: 'market/news', lazy: async () => ({ Component: (await import('./ui/pages/MarketNewsPage')).MarketNewsPage }) },
          { path: 'market/bigmoney', lazy: async () => ({ Component: (await import('./ui/pages/BigMoneyPage')).BigMoneyPage }) },
          { path: 'market/earnings', lazy: async () => ({ Component: (await import('./ui/pages/EarningsPage')).EarningsPage }) },
          { path: 'portfolio', lazy: async () => ({ Component: (await import('./ui/pages/PortfolioPage')).PortfolioPage }) },
          { path: 'assets/:id', lazy: async () => ({ Component: (await import('./ui/pages/AssetPage')).AssetPage }) },
          { path: 'plans', lazy: async () => ({ Component: (await import('./ui/pages/PlansPage')).PlansPage }) },
          { path: 'income', lazy: async () => ({ Component: (await import('./ui/pages/IncomePage')).IncomePage }) },
          { path: 'summary', lazy: async () => ({ Component: (await import('./ui/pages/SummaryPage')).SummaryPage }) },
          { path: 'tax', lazy: async () => ({ Component: (await import('./ui/pages/TaxPage')).TaxPage }) },
          { path: 'trades', lazy: async () => ({ Component: (await import('./ui/pages/TradesPage')).TradesPage }) },
          { path: 'fx', lazy: async () => ({ Component: (await import('./ui/pages/FxPage')).FxPage }) },
          { path: 'import', lazy: async () => ({ Component: (await import('./ui/pages/ImportPage')).ImportPage }) },
          { path: 'more', lazy: async () => ({ Component: (await import('./ui/pages/MorePage')).MorePage }) },
          { path: 'settings', lazy: async () => ({ Component: (await import('./ui/pages/SettingsPage')).SettingsPage }) },
          { path: 'privacy', lazy: async () => ({ Component: (await import('./ui/pages/PrivacyPage')).PrivacyPage }) },
          { path: 'transactions', lazy: async () => ({ Component: (await import('./ui/pages/TransactionsPage')).TransactionsPage }) },
          { path: 'transactions/new', lazy: transactionForm },
          { path: 'transactions/:id', lazy: transactionForm },
        ],
      },
    ],
  },
]
