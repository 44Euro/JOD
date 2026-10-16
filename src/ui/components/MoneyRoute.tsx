import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'

export interface Station {
  value: string
  label: string
  tone?: 'gain' | 'loss' | 'fx'
  fx?: boolean
}

const TONE: Record<NonNullable<Station['tone']>, string> = { gain: 'text-gain', loss: 'text-loss', fx: 'text-fx' }

function routeGradient(stations: readonly Station[], direction: string): string {
  const legs = stations.length - 1
  const stops = stations.slice(1).map((station, i) => {
    const color = station.fx ? 'var(--fx)' : 'var(--market-us)'
    return `${color} ${((i / legs) * 100).toFixed(2)}% ${(((i + 1) / legs) * 100).toFixed(2)}%`
  })
  return `linear-gradient(${direction}, ${stops.join(', ')})`
}

export function MoneyRoute({ label, stations }: { label: string; stations: readonly Station[] }) {
  const style = {
    '--n': stations.length,
    '--route-h': routeGradient(stations, '90deg'),
    '--route-v': routeGradient(stations, '180deg'),
  } as CSSProperties
  return (
    <ol
      aria-label={label}
      style={style}
      className="relative grid gap-3 pl-9 md:grid-cols-[repeat(var(--n),minmax(0,1fr))] md:gap-0 md:pl-0"
    >
      <span
        aria-hidden
        className="absolute top-2.5 bottom-2.5 left-2 w-1.5 rounded-full [background:var(--route-v)] md:inset-x-[calc(50%/var(--n))] md:top-3 md:bottom-auto md:h-2 md:w-auto md:[background:var(--route-h)]"
      />
      {stations.map((station, i) => (
        <li
          key={station.label}
          className="relative flex items-center justify-between gap-2 text-sm text-ink-2 md:grid md:justify-items-center md:gap-px md:px-1 md:text-center md:text-[13px]"
        >
          <span
            aria-hidden
            className={cn(
              'absolute top-0.5 -left-9 size-[22px] rounded-full border-[5px] bg-card md:static md:mb-1.5 md:size-8 md:border-[6px]',
              station.fx ? 'border-fx' : 'border-foreground',
              i === stations.length - 1 && 'md:-mt-1 md:size-10',
            )}
          />
          <b
            className={cn(
              'order-2 font-display text-base font-semibold text-foreground md:order-none md:text-[19px]',
              station.tone && TONE[station.tone],
            )}
          >
            {station.value}
          </b>
          <span className="order-1 md:order-none">{station.label}</span>
        </li>
      ))}
    </ol>
  )
}

export function MiniRoute({ from, via, to }: { from: string; via: string; to: string }) {
  return (
    <div>
      <div aria-hidden className="flex items-center">
        <span className="size-[22px] shrink-0 rounded-full border-[5px] border-foreground bg-card" />
        <span className="h-1.5 flex-1 rounded-full bg-route-neutral" />
        <span className="size-7 shrink-0 rounded-full border-[5px] border-fx bg-card" />
        <span className="h-1.5 flex-1 rounded-full bg-market-us" />
        <span className="size-[22px] shrink-0 rounded-full border-[5px] border-foreground bg-card" />
      </div>
      <p className="mt-2 flex justify-between gap-2 text-[12.5px] text-ink-2">
        <span>{from}</span>
        <span className="text-fx">{via}</span>
        <span>{to}</span>
      </p>
    </div>
  )
}
