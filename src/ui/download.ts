export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Safari can still be reading the blob right after click(), so release it a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
