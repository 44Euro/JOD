import type { AssetType, Market } from '../domain/types'
import { readSync } from '../sync/state'

export interface FoundAsset {
  market: Market
  symbol: string
  name: string
  assetType: AssetType
}

export interface MarketQuote {
  id: string
  price: string
  currency: string
  at: string
  previousClose: string | null
  previousCloseAt: string | null
  source: string
}

export interface MarketClient {
  ready(): boolean
  search(query: string, signal?: AbortSignal): Promise<FoundAsset[]>
  quotes(ids: string[], signal?: AbortSignal): Promise<MarketQuote[]>
}

type Where = () => { server: string; token: string } | null

const session: Where = () => {
  const state = readSync()
  return state ? { server: state.server, token: state.token } : null
}

// Market data comes from the JOD sync server, which fetches it for every device; the session token only proves the
// asker is signed in.
export function createMarketClient(where: Where = session, fetchFn: typeof fetch = (i, o) => fetch(i, o)): MarketClient {
  const searches = new Map<string, Promise<FoundAsset[]>>()

  async function get(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const at = where()
    if (!at) throw new Error('not signed in')
    const res = await fetchFn(at.server.replace(/\/+$/, '') + path, { headers: { authorization: `Bearer ${at.token}` }, signal })
    if (!res.ok) throw new Error(`market server answered ${res.status}`)
    return (await res.json()) as Record<string, unknown>
  }

  return {
    ready: () => where() !== null,
    search(query, signal) {
      const key = query.trim().toLowerCase()
      const hit = searches.get(key)
      if (hit) return hit
      const found = get(`/api/market/search?q=${encodeURIComponent(key)}`, signal).then((body) => body.results as FoundAsset[])
      // A failed or cancelled search is asked again next time.
      found.catch(() => searches.delete(key))
      searches.set(key, found)
      return found
    },
    async quotes(ids, signal) {
      return (await get(`/api/market/quotes?ids=${encodeURIComponent(ids.join(','))}`, signal)).quotes as MarketQuote[]
    },
  }
}

export const marketClient = createMarketClient()
