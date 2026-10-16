import type { RouteObject } from 'react-router'
import { Layout } from './ui/Layout'
import { DashboardPage } from './ui/pages/DashboardPage'
import { SettingsPage } from './ui/pages/SettingsPage'
import { TransactionsPage } from './ui/pages/TransactionsPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
    ],
  },
]
