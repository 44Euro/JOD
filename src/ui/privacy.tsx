import { useLiveQuery } from 'dexie-react-hooks'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { db } from '../db/db'
import { getSettings } from '../db/repo'
import { DEFAULT_SETTINGS } from '../domain/types'
import { setNumbersHidden } from './format'
import { usePrivacy } from './hooks'
import { t } from '../i18n'

// Nothing is rendered until the settings have been read once: a session that opens hidden must not paint a real figure first.
export function PrivacyProvider({ children }: { children: ReactNode }) {
  // A settings read that fails must not leave the app blank; it opens with the numbers shown.
  const settings = useLiveQuery(() => getSettings(db).catch(() => DEFAULT_SETTINGS), [])
  const [seeded, setSeeded] = useState(false)

  // The setting only decides how the app opens; once seeded, turning it on or off must not hide or show this visit's numbers.
  // The flag is written before any child has rendered, so there is no one to notify yet.
  if (settings && !seeded) {
    setNumbersHidden(settings.hideNumbersOnLaunch === true)
    setSeeded(true)
  }

  // The flag is module state, so it must end with the provider that set it.
  useEffect(() => () => setNumbersHidden(false), [])

  return seeded ? children : null
}

export function EyeButton() {
  const { hidden, toggle } = usePrivacy()
  const label = hidden ? t('แสดงตัวเลข') : t('ซ่อนตัวเลข')
  const Icon = hidden ? EyeOff : Eye
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      className="text-ink-2 [&_svg]:size-5"
      onClick={toggle}
    >
      <Icon aria-hidden />
    </Button>
  )
}
