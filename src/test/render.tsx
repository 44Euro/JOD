import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ChatModel } from '../ai/chat'
import { ChatModelContext } from '../ai/chatProviders'
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

const offlineChat: ChatModel = () => ({ next: () => Promise.reject(new Error('no AI in tests')), give: () => {} })

export function renderRoute(path: string, provider: FxProvider = fakeFxProvider({}).provider, reader: AiReader = offlineReader, chat: ChatModel = offlineChat) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <FxProviderContext.Provider value={provider}>
      <AiReaderContext.Provider value={() => reader}>
        <ChatModelContext.Provider value={() => chat}>
          <RouterProvider router={router} />
        </ChatModelContext.Provider>
      </AiReaderContext.Provider>
    </FxProviderContext.Provider>,
  )
  return router
}

export async function resetDb() {
  await Promise.all(db.tables.map((table) => table.clear()))
}
