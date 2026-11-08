import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { t } from '../../i18n'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

// Records are kept on the device first, so being offline only delays the sync; saying so keeps people recording.
export function OfflineBar() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (online) return null
  return (
    <p role="status" className="flex items-center gap-2 rounded-xl bg-muted px-3.5 py-2.5 text-[13px] text-ink-2">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      {t('ออฟไลน์ · บันทึกได้ตามปกติ ข้อมูลจะซิงก์เมื่อกลับมาออนไลน์')}
    </p>
  )
}
