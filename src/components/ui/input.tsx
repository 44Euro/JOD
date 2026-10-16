import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

// 16px text on every screen size stops iOS Safari from zooming into a focused field.
const fieldBase =
  'w-full rounded-xl border border-input bg-card px-3.5 text-base text-foreground placeholder:text-placeholder focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-destructive'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, 'h-[46px]', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldBase, 'min-h-20 py-2.5', className)} {...props} />
}

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldBase, 'h-[46px]', className)} {...props} />
}
