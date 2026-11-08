import { t } from '../../i18n'

// The outline of a page while its data loads, so the screen is never blank with a word in the corner.
export function PageLoading() {
  return (
    <div role="status" className="grid gap-3.5 md:gap-6">
      <span className="sr-only">{t('กำลังโหลด…')}</span>
      <div data-skeleton className="h-9 w-40 rounded-lg bg-muted" aria-hidden />
      <div data-skeleton className="h-40 rounded-2xl bg-muted" aria-hidden />
      <div data-skeleton className="h-28 rounded-2xl bg-muted" aria-hidden />
      <div data-skeleton className="h-28 rounded-2xl bg-muted" aria-hidden />
    </div>
  )
}
