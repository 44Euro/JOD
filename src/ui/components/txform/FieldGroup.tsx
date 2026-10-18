import type { ReactNode } from 'react'

// The hairline sits on a wrapper because a border on the fieldset itself runs through its legend.
export function FieldGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 [&~&]:border-t [&~&]:pt-4">
      <fieldset className="grid min-w-0 gap-3.5">
        <legend className="mb-3.5 font-display text-base font-semibold text-ink-2">{legend}</legend>
        {children}
      </fieldset>
    </div>
  )
}
