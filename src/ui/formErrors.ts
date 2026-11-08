// Validation messages name the field by its label ("จำนวนหน่วยต้องเป็น…"), so the field each one belongs to is found by
// its label rather than by threading field keys through every validator.
const ASSET_MISSING = /^กรุณาระบุ(หุ้น\/สินทรัพย์|สัญลักษณ์)/

function subjectOf(error: string): string {
  if (ASSET_MISSING.test(error)) return 'สัญลักษณ์'
  return error.replace(/^กรุณาระบุ/, '').split(/ต้อง|ห้าม|ยาวเกิน/)[0].trim()
}

// Marks the fields the errors name, clears the rest and moves the focus to the first, which also scrolls it into view.
export function markInvalid(form: HTMLFormElement | null, errors: readonly string[]): void {
  if (!form) return
  const subjects = errors.map(subjectOf).filter(Boolean)
  let first: HTMLElement | null = null
  for (const label of form.querySelectorAll('label[for]')) {
    const control = form.ownerDocument.getElementById(label.getAttribute('for') ?? '')
    if (!control) continue
    const text = (label.textContent ?? '').trim()
    const invalid = text !== '' && subjects.some((s) => text.startsWith(s) || s.startsWith(text))
    if (invalid) control.setAttribute('aria-invalid', 'true')
    else control.removeAttribute('aria-invalid')
    if (invalid && !first) first = control
  }
  first?.focus()
}
