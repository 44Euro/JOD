import { CircleAlert, CircleCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

const TONES = {
  warning: { className: 'bg-warning-bg text-warning-fg', icon: TriangleAlert },
  error: { className: 'bg-destructive-bg text-destructive', icon: CircleAlert },
  ok: { className: 'bg-gain-soft text-gain-ink', icon: CircleCheck },
} satisfies Record<string, { className: string; icon: LucideIcon }>

export function Alert({
  className,
  tone = 'warning',
  icon,
  children,
  ...props
}: ComponentProps<'div'> & { tone?: keyof typeof TONES; icon?: LucideIcon }) {
  const Icon = icon ?? TONES[tone].icon
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-[14px] px-4 py-3 text-sm [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-[3px]',
        TONES[tone].className,
        className,
      )}
      {...props}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
