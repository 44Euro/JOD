import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'

// fx = a currency station (purple ring); neutral = plain money with no market yet, so its leg is grey.
export interface Station {
  value: string
  label: string
  tone?: 'gain' | 'loss' | 'fx'
  fx?: boolean
  neutral?: boolean
}

const TONE: Record<NonNullable<Station['tone']>, string> = { gain: 'text-gain', loss: 'text-loss', fx: 'text-fx' }

function legColor(station: Station): string {
  if (station.fx) return 'var(--fx)'
  return station.neutral ? 'var(--route-neutral)' : 'var(--market-us)'
}

// Each leg takes the colour of the station it leaves, as in the mocks: the stretch after a currency
// station is purple.
function routeGradient(stations: readonly Station[], direction: string): string {
  const legs = stations.length - 1
  const stops = stations.slice(0, -1).map((station, i) => {
    return `${legColor(station)} ${((i / legs) * 100).toFixed(2)}% ${(((i + 1) / legs) * 100).toFixed(2)}%`
  })
  return `linear-gradient(${direction}, ${stops.join(', ')})`
}

// The horizontal layout is chosen by the route's own width (container query), not the screen's: seven stations
// need about 768px of it, and a tablet next to a sidebar has less than that to give.
export function MoneyRoute({ label, stations }: { label: string; stations: readonly Station[] }) {
  const style = {
    '--n': stations.length,
    '--route-h': routeGradient(stations, '90deg'),
    '--route-v': routeGradient(stations, '180deg'),
  } as CSSProperties
  return (
    <div className="@container">
      <ol
        aria-label={label}
        style={style}
        className="relative grid gap-3 pl-9 @min-[768px]:grid-cols-[repeat(var(--n),minmax(0,1fr))] @min-[768px]:gap-0 @min-[768px]:pl-0"
      >
        <span
          aria-hidden
          className="absolute top-2.5 bottom-2.5 left-2 w-1.5 rounded-full [background:var(--route-v)] @min-[768px]:inset-x-[calc(50%/var(--n))] @min-[768px]:top-3 @min-[768px]:bottom-auto @min-[768px]:h-2 @min-[768px]:w-auto @min-[768px]:[background:var(--route-h)]"
        />
        {stations.map((station, i) => (
          <li
            key={station.label}
            className="relative flex items-center gap-2 text-sm text-ink-2 @max-[768px]:justify-between @min-[768px]:grid @min-[768px]:content-start @min-[768px]:justify-items-center @min-[768px]:gap-px @min-[768px]:px-1 @min-[768px]:text-center @min-[768px]:text-[13px]"
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-0.5 -left-9 size-6 rounded-full border-[5px] bg-card @min-[768px]:static @min-[768px]:size-8 @min-[768px]:border-[6px]',
                i === stations.length - 1
                  ? '@min-[768px]:-mt-1 @min-[768px]:mb-0.5 @min-[768px]:size-10'
                  : '@min-[768px]:mb-1.5',
                station.fx ? 'border-fx' : 'border-foreground',
              )}
            />
            <b
              className={cn(
                'order-2 font-display text-base font-semibold text-foreground @min-[768px]:order-none @min-[768px]:text-[19px]',
                station.tone && TONE[station.tone],
              )}
            >
              {station.value}
            </b>
            <span className="order-1 @min-[768px]:order-none">{station.label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function MiniRoute({ from, via, to }: { from: string; via: string; to: string }) {
  return (
    <div>
      <div aria-hidden className="flex items-center">
        <span className="size-6 shrink-0 rounded-full border-[5px] border-foreground bg-card" />
        <span className="h-1.5 flex-1 rounded-full bg-route-neutral" />
        <span className="size-7 shrink-0 rounded-full border-[5px] border-fx bg-card" />
        <span className="h-1.5 flex-1 rounded-full bg-market-us" />
        <span className="size-6 shrink-0 rounded-full border-[5px] border-foreground bg-card" />
      </div>
      <p className="mt-2 flex justify-between gap-2 text-[13px] text-ink-2">
        <span>{from}</span>
        <span className="text-fx">{via}</span>
        <span>{to}</span>
      </p>
    </div>
  )
}
