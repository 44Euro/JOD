import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function Chip({ active, className, ...props }: ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 md:h-9',
        active ? 'border-foreground bg-foreground text-white' : 'bg-card text-ink-2 hover:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

// Stays at 16px on phones so iOS does not zoom when the filter opens.
export const chipSelectClass = 'h-11 w-auto rounded-full border-border px-3 text-ink-2 md:h-9 md:text-[13px]'
