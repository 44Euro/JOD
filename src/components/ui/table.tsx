import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  )
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn('whitespace-nowrap px-2 pb-2 text-left text-xs font-normal text-muted-foreground', className)}
      {...props}
    />
  )
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('whitespace-nowrap border-t border-muted px-2 py-3 align-middle', className)} {...props} />
}
