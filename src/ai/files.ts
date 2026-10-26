import { t } from '../i18n'
import { toBase64 } from '../security/crypto'
export const MAX_IMAGE_EDGE = 2576

const SENDABLE_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type ImageMediaType = (typeof SENDABLE_IMAGES)[number]

export type PreparedFile =
  | { kind: 'image'; name: string; mediaType: ImageMediaType; data: string; width: number; height: number; previewUrl: string }
  | { kind: 'pdf'; name: string; data: string; pages: number }
  | { kind: 'text'; name: string; data: string }

export class FileError extends Error {
  name = 'FileError'
}

export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// Counting page objects is rough (an odd PDF can hide some), but it only feeds the cost estimate.
export function countPdfPages(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes)
  return Math.max(1, (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length)
}

function isSendableImage(type: string): type is ImageMediaType {
  return (SENDABLE_IMAGES as readonly string[]).includes(type)
}

// Images larger than the model reads are shrunk here, which also keeps the cost down; a format the API does not take
// (HEIC from some phones) is redrawn as JPEG.
async function prepareImage(file: File): Promise<PreparedFile> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new FileError(t('เปิดรูป {0} ไม่ได้', file.name))
  }
  const size = fitWithin(bitmap.width, bitmap.height)
  let blob: Blob = file
  let mediaType = file.type
  if (size.width !== bitmap.width || !isSendableImage(file.type)) {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height)
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new FileError(t('ย่อรูป {0} ไม่ได้', file.name)))), 'image/jpeg', 0.9),
    )
    mediaType = 'image/jpeg'
  }
  bitmap.close()
  const data = toBase64(new Uint8Array(await blob.arrayBuffer()))
  return {
    kind: 'image',
    name: file.name,
    mediaType: mediaType as ImageMediaType,
    data,
    ...size,
    previewUrl: URL.createObjectURL(blob),
  }
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  const name = file.name.toLowerCase()
  if (file.type.startsWith('image/')) return prepareImage(file)
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { kind: 'pdf', name: file.name, data: toBase64(bytes), pages: countPdfPages(bytes) }
  }
  if (/\.(csv|txt|tsv)$/.test(name) || file.type.startsWith('text/')) {
    return { kind: 'text', name: file.name, data: await file.text() }
  }
  if (/\.(xlsx?|numbers)$/.test(name)) throw new FileError(t('{0}: บันทึกไฟล์ Excel เป็น CSV ก่อนแล้วใส่ใหม่', file.name))
  throw new FileError(t('{0}: ใส่ได้เฉพาะรูป, PDF หรือ CSV', file.name))
}

// Rough token counts: an image costs about width × height ÷ 750, a PDF page (text plus its picture) about 2,000, and
// Thai text about one token per two characters. Each file is answered with roughly 2,500 tokens, thinking included.
const PROMPT_TOKENS = 1_200
const OUTPUT_TOKENS_PER_FILE = 2_500
const USD_PER_INPUT_TOKEN = 4 / 1_000_000
const USD_PER_OUTPUT_TOKEN = 20 / 1_000_000

export function estimateTokens(files: readonly PreparedFile[]): { input: number; output: number } {
  const input = files.reduce((sum, file) => {
    if (file.kind === 'image') return sum + Math.ceil((file.width * file.height) / 750)
    if (file.kind === 'pdf') return sum + file.pages * 2_000
    return sum + Math.ceil(file.data.length / 2)
  }, PROMPT_TOKENS)
  return { input, output: files.length * OUTPUT_TOKENS_PER_FILE }
}

// usdRate is the base currency per dollar; the estimate is shown in the base currency, rounded up to a whole unit.
export function estimateCost(files: readonly PreparedFile[], usdRate: number): number {
  if (files.length === 0) return 0
  const { input, output } = estimateTokens(files)
  return Math.max(1, Math.ceil((input * USD_PER_INPUT_TOKEN + output * USD_PER_OUTPUT_TOKEN) * usdRate))
}
