import { createHashRouter, RouterProvider } from 'react-router'
import { routes } from './routes'

// Hash URLs keep deep links working on any static host without rewrite rules.
const router = createHashRouter(routes)

export default function App() {
  return <RouterProvider router={router} />
}
