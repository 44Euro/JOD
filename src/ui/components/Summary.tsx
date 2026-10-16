import type { ReactNode } from 'react'
import { Card } from '../../components/ui/card'
import { cn } from '../../lib/cn'

export function SummaryPanel({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-wrap items-end justify-between gap-6">
      <div>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="font-display text-[42px] font-semibold leading-[1.05] tracking-[-0.01em] md:text-[64px]">{value}</p>
      </div>
      {children && (
        <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:gap-10 [&>*:first-child:nth-last-child(3)]:col-span-2">
          {children}
        </div>
      )}
    </Card>
  )
}

export function Stat({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="rounded-[14px] border p-2.5 md:border-0 md:p-0">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={cn('font-display text-[19px] font-semibold leading-tight md:text-[28px]', tone)}>{value}</p>
      {note && <p className="text-[12.5px] text-muted-foreground max-md:hidden">{note}</p>}
    </div>
  )
}
