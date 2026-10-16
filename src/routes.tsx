import type { RouteObject } from 'react-router'
import { Layout } from './ui/Layout'
import { DashboardPage } from './ui/pages/DashboardPage'
import { PortfolioPage } from './ui/pages/PortfolioPage'
import { SettingsPage } from './ui/pages/SettingsPage'
import { TransactionFormPage } from './ui/pages/TransactionFormPage'
import { TransactionsPage } from './ui/pages/TransactionsPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'portfolio', element: <PortfolioPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'transactions/new', element: <TransactionFormPage /> },
      { path: 'transactions/:id', element: <TransactionFormPage /> },
    ],
  },
]
