import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'

// The hairline sits on a wrapper because a border on the fieldset itself runs through its legend. It follows a group
// that comes before it on its own; `divided` is for a group that has to be set apart from other kinds of fields.
export function FieldGroup({ legend, divided = false, children }: { legend: string; divided?: boolean; children: ReactNode }) {
  return (
    <div className={cn('grid min-w-0 [&~&]:border-t [&~&]:pt-4', divided && 'border-t pt-4')}>
      <fieldset className="grid min-w-0 gap-3.5">
        <legend className="mb-3.5 font-display text-base font-semibold text-ink-2">{legend}</legend>
        {children}
      </fieldset>
    </div>
  )
}
