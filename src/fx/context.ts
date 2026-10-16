import { createContext, useContext } from 'react'
import { createFrankfurterProvider, type FxProvider } from './frankfurter'

export const FxProviderContext = createContext<FxProvider>(createFrankfurterProvider())

export function useFxProvider(): FxProvider {
  return useContext(FxProviderContext)
}
