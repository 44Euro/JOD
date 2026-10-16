import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('min-w-0 rounded-[18px] border bg-card p-4 md:rounded-[20px] md:px-[26px] md:py-[22px]', className)}
      {...props}
    />
  )
}
