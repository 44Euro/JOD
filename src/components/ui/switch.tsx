import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

// The button is the 44px touch target; the 44x24 track inside it is only what is drawn.
export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'role' | 'onClick'> & { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn('group inline-flex h-11 min-w-11 shrink-0 items-center justify-center focus-visible:outline-none', className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'relative block h-6 w-11 rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/35',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow-sm shadow-foreground/20 transition-transform', checked && 'translate-x-5')}
        />
      </span>
    </button>
  )
}
