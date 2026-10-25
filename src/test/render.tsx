import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AiReaderContext, type AiReader } from '../ai/reader'
import { db } from '../db/db'
import { FxProviderContext } from '../fx/context'
import type { FxProvider } from '../fx/frankfurter'
import { routes } from '../routes'
import { fakeFxProvider } from './fakeFx'

const offlineReader: AiReader = {
  read: () => Promise.reject(new Error('no AI in tests')),
  test: () => Promise.reject(new Error('no AI in tests')),
}

export function renderRoute(path: string, provider: FxProvider = fakeFxProvider({}).provider, reader: AiReader = offlineReader) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <FxProviderContext.Provider value={provider}>
      <AiReaderContext.Provider value={() => reader}>
        <RouterProvider router={router} />
      </AiReaderContext.Provider>
    </FxProviderContext.Provider>,
  )
  return router
}

export async function resetDb() {
  await Promise.all(db.tables.map((table) => table.clear()))
}
