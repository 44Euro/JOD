import type { ReactNode } from 'react'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { cn } from '../../lib/cn'

// footer sits inside the same panel under the numbers, as the route and the income chart do in the mocks.
export function SummaryPanel({
  label,
  value,
  children,
  footer,
}: {
  label: string
  value: string
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[13px] text-muted-foreground">{label}</p>
          <p className="font-display text-[42px] font-semibold leading-[1.05] tracking-[-0.01em] md:text-[64px]">{value}</p>
        </div>
        {children && (
          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:gap-10 [&>*:first-child:nth-last-child(3)]:col-span-2">
            {children}
          </div>
        )}
      </div>
      {footer && <div className="mt-6 md:mt-[26px]">{footer}</div>}
    </Card>
  )
}

// flag is a short warning shown next to the number, e.g. when the prices behind it are old.
export function Stat({
  label,
  value,
  tone,
  valueClassName,
  note,
  flag,
}: {
  label: string
  value: string
  tone?: string
  // For a page whose tiles are narrower than the default number size allows.
  valueClassName?: string
  note?: ReactNode
  flag?: string
}) {
  return (
    <div className="rounded-[14px] border p-2.5 md:border-0 md:p-0">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-x-2">
        <p className={cn('font-display text-[19px] font-semibold leading-tight md:text-[28px]', tone, valueClassName)}>{value}</p>
        {flag && <Badge variant="warning">{flag}</Badge>}
      </div>
      {note && <p className="text-[12.5px] text-muted-foreground max-md:hidden">{note}</p>}
    </div>
  )
}
