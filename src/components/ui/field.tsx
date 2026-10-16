import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <label htmlFor={id} className="text-[13.5px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
