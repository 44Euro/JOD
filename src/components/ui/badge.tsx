import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-[7px] py-px text-[11.5px] font-semibold [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-muted text-ink-2',
        auto: 'bg-fx-soft text-fx',
        manual: 'bg-primary-soft text-primary-ink',
        estimated: 'border-[1.5px] border-dashed border-fx text-fx',
        warning: 'bg-warning-bg text-warning-fg',
        void: 'border-[1.5px] border-destructive text-destructive',
        ok: 'bg-gain-soft text-gain-ink',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
