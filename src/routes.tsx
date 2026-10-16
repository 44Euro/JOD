import type { RouteObject } from 'react-router'
import { Layout } from './ui/Layout'
import { DashboardPage } from './ui/pages/DashboardPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [{ index: true, element: <DashboardPage /> }],
  },
]
