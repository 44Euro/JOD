import { cn } from '../../lib/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-muted p-[3px] md:inline-flex', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-11 shrink-0 whitespace-nowrap rounded-[9px] px-3.5 text-[13.5px] text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 md:h-8',
            option.value === value && 'bg-card font-semibold text-foreground shadow-sm shadow-foreground/10',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
