import type { ReactNode } from 'react'

export function PageHeader({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[26px] font-semibold leading-tight md:text-[34px]">{title}</h1>
      {(note || children) && (
        <div className="flex flex-wrap items-center gap-2">
          {note && <span className="text-[13px] text-muted-foreground max-md:hidden">{note}</span>}
          {children}
        </div>
      )}
    </div>
  )
}
