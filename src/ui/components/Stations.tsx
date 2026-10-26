import { Fragment } from 'react'
import { cn } from '../../lib/cn'

export function Stations({ steps, step }: { steps: readonly string[]; step: number }) {
  return (
    <ol aria-label="ขั้นตอน" className="flex items-center">
      {steps.map((label, index) => (
        <Fragment key={label}>
          {index > 0 && (
            <li aria-hidden className={cn('mx-1.5 h-[5px] min-w-3 flex-1 rounded-full sm:mx-2.5 sm:min-w-6', index <= step ? 'bg-foreground' : 'bg-input')} />
          )}
          <li
            aria-current={index === step ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 text-[13px] whitespace-nowrap',
              index === step ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-[26px] shrink-0 rounded-full border-4 bg-card',
                index < step && 'border-foreground bg-foreground',
                index === step && 'border-primary',
                index > step && 'border-input',
              )}
            />
            {/* Phones show only the current station's name, as in the mock. */}
            <span className={cn(index !== step && 'max-sm:sr-only')}>{label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  )
}
