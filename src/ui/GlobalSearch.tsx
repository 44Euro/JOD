import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { SearchSheet } from './components/SearchSheet'
import { useAppData } from './hooks'
import { foundPath } from './nav'

// ⌘K (Ctrl+K elsewhere) opens the asset search from any page.
export function GlobalSearch() {
  const data = useAppData()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      // A search already open, such as the one in the transaction form, keeps the keyboard.
      if (!document.querySelector('[aria-modal="true"]')) setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const instruments = data?.instruments ?? []
  return <SearchSheet open={open} onClose={() => setOpen(false)} onPick={(found) => navigate(foundPath(found, instruments))} instruments={instruments} />
}
