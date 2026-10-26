export const WELCOME_STORAGE_KEY = 'jod-welcomed'

export function seenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

export function markWelcomed() {
  try {
    localStorage.setItem(WELCOME_STORAGE_KEY, '1')
  } catch {
    // Without storage the welcome simply shows again next time.
  }
}
