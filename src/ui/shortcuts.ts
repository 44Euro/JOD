import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

export const SEARCH_INPUT_ID = 'transaction-search'

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// Spec 10.1: N opens a new transaction and / jumps to search, but never while typing or with a modifier held.
export function useShortcuts(): void {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || isTypingTarget(event.target)) return
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        navigate('/transactions/new')
      } else if (event.key === '/') {
        event.preventDefault()
        const search = document.getElementById(SEARCH_INPUT_ID)
        if (pathname === '/transactions' && search) search.focus()
        else navigate('/transactions', { state: { focusSearch: true } })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, pathname])
}
