import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { db } from '../db/db'
import { FxProviderContext } from '../fx/context'
import type { FxProvider } from '../fx/frankfurter'
import { routes } from '../routes'
import { fakeFxProvider } from './fakeFx'

export function renderRoute(path: string, provider: FxProvider = fakeFxProvider({}).provider) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <FxProviderContext.Provider value={provider}>
      <RouterProvider router={router} />
    </FxProviderContext.Provider>,
  )
  return router
}

export async function resetDb() {
  await Promise.all(db.tables.map((table) => table.clear()))
}
