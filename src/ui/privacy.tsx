import { useLiveQuery } from 'dexie-react-hooks'
import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { db } from '../db/db'
import { getSettings } from '../db/repo'
import { setNumbersHidden } from './format'
import { PrivacyContext, usePrivacy } from './hooks'

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const settings = useLiveQuery(() => getSettings(db), [])
  const [hidden, setHidden] = useState(false)
  // The setting only decides how the app opens; once seeded, turning it on or off must not hide or show this visit's numbers.
  const [seeded, setSeeded] = useState(false)

  if (settings && !seeded) {
    setSeeded(true)
    setHidden(settings.hideNumbersOnLaunch === true)
  }
  setNumbersHidden(hidden)

  // The flag is module state, so it must end with the provider that set it.
  useEffect(() => () => setNumbersHidden(false), [])

  const toggle = useCallback(() => {
    setSeeded(true)
    setHidden((current) => !current)
  }, [])
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle])
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
}

// The page is rebuilt when the choice flips, which replaces this button, so the new one takes the focus the old one had.
let refocusEye = false

export function EyeButton() {
  const { hidden, toggle } = usePrivacy()
  const label = hidden ? 'แสดงตัวเลข' : 'ซ่อนตัวเลข'
  const Icon = hidden ? EyeOff : Eye
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      className="[&_svg]:size-5"
      ref={(button) => {
        if (button && refocusEye) {
          refocusEye = false
          button.focus()
        }
      }}
      onClick={() => {
        refocusEye = true
        toggle()
      }}
    >
      <Icon aria-hidden />
    </Button>
  )
}
