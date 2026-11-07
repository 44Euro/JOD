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
  singleRow = false,
  className,
}: {
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  // For segments that are a digit each, which fit one row on any phone; the two-column fallback is for long labels.
  singleRow?: boolean
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-muted p-[3px] max-md:w-full md:inline-flex',
        // Four Thai labels are about 240px of text, more than a 320px phone has left in one row.
        options.length > 3 && !singleRow && 'max-[380px]:grid max-[380px]:grid-cols-2',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            // Basis auto with shrink-0 makes each segment start from its text and grow only into the spare room on a phone;
            // min-w-11 is just the 44px floor. An equal share of the row (flex-1) would print a long label over its neighbour.
            'h-11 min-w-11 shrink-0 whitespace-nowrap rounded-[9px] px-3.5 text-[13px] text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 max-md:grow max-md:px-2 md:h-8',
            option.value === value && 'bg-card font-semibold text-foreground shadow-sm shadow-foreground/10',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
