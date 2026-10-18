import type { ReactNode } from 'react'

export function FieldGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-3.5">
      <legend className="mb-3.5 font-display text-sm font-semibold text-ink-2">{legend}</legend>
      {children}
    </fieldset>
  )
}
