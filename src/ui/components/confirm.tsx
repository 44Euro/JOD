import { useEffect, useId } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

interface Ask {
  message: string
  action: string
  danger?: boolean
}

function ConfirmDialog({ message, action, danger, answer }: Ask & { answer(ok: boolean): void }) {
  const id = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && answer(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [answer])
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-[rgb(11_31_58/0.45)] p-4 sm:place-items-center" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={id} className="grid w-full max-w-[400px] gap-5 rounded-2xl bg-card p-5 text-foreground shadow-[0_16px_40px_-16px_rgb(11_31_58/0.45)]">
        <p id={id} className="text-[15px] leading-relaxed">
          {message}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {/* Cancel takes the focus, so Enter on a destructive question does nothing harmful. */}
          <Button type="button" variant="outline" autoFocus onClick={() => answer(false)}>
            {t('ยกเลิก')}
          </Button>
          <Button type="button" variant={danger ? 'destructive' : 'default'} onClick={() => answer(true)}>
            {action}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Asks in the app's own dialog instead of the browser's, which on a phone is the system alert with no red for deleting.
export function askConfirm(ask: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let done = false
    const answer = (ok: boolean) => {
      if (done) return
      done = true
      // Unmounting inside the click that answered would tear the root down mid-render.
      queueMicrotask(() => {
        root.unmount()
        host.remove()
      })
      opener?.focus()
      resolve(ok)
    }
    root.render(<ConfirmDialog {...ask} answer={answer} />)
  })
}
