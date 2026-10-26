import { EN } from './en'

// Thai is the source language: every piece of text in the code is the Thai wording, wrapped in t(). English looks the
// Thai up in a dictionary and falls back to it, so a missing translation shows Thai rather than nothing. The language
// is read once at start; switching reloads the app, so text built when a module loads is in the right language too.
export const LANGUAGES = ['th', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export const LANG_STORAGE_KEY = 'jod-lang'

function stored(): Language {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'en' ? 'en' : 'th'
  } catch {
    return 'th'
  }
}

let current: Language = stored()

export function language(): Language {
  return current
}

export function setLanguageForTests(next: Language) {
  current = next
}

export function chooseLanguage(next: Language) {
  try {
    if (next === 'th') localStorage.removeItem(LANG_STORAGE_KEY)
    else localStorage.setItem(LANG_STORAGE_KEY, next)
  } catch {
    // Without storage the choice cannot outlive the reload.
  }
  location.reload()
}

// {0}, {1} in the text are filled with the arguments in order.
export function t(text: string, ...args: unknown[]): string {
  const template = current === 'en' ? (EN[text] ?? text) : text
  return args.length === 0 ? template : template.replace(/\{(\d+)\}/g, (match, i) => (Number(i) < args.length ? String(args[Number(i)]) : match))
}
