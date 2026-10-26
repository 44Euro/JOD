import { fromBase64 } from '../security/crypto'
import type { PreparedFile } from './files'

type ImageFile = Extract<PreparedFile, { kind: 'image' }>

// The libraries are loaded only when a file is read, so the app itself stays small. Tesseract downloads its Thai and
// English models once; the picture never leaves the device.
export async function recognizeImage(file: ImageFile, signal?: AbortSignal): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['eng', 'tha'])
  const stop = () => void worker.terminate()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const { data } = await worker.recognize(`data:${file.mediaType};base64,${file.data}`)
    signal?.throwIfAborted()
    return data.text
  } finally {
    signal?.removeEventListener('abort', stop)
    await worker.terminate().catch(() => {})
  }
}

// A PDF's text layer holds each word with its position; words on the same baseline are joined back into a line.
export async function pdfLines(file: Extract<PreparedFile, { kind: 'pdf' }>): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const bytes = fromBase64(file.data)
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  const lines: string[] = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent()
    const rows = new Map<number, { x: number; text: string }[]>()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = Math.round(item.transform[5])
      rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4], text: item.str }])
    }
    for (const [, words] of [...rows].sort(([a], [b]) => b - a)) {
      lines.push(words.sort((a, b) => a.x - b.x).map((w) => w.text).join(' '))
    }
  }
  return lines
}
