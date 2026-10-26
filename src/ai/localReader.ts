import { readCsv } from './csvReader'
import type { Extraction } from './extraction'
import type { PreparedFile } from './files'
import { pdfLines, recognizeImage } from './ocr'
import type { AiReader } from './reader'
import { rowsFromLines } from './textRows'

export interface LocalReaderSteps {
  recognize: (file: Extract<PreparedFile, { kind: 'image' }>, signal?: AbortSignal) => Promise<string>
  pdfLines: (file: Extract<PreparedFile, { kind: 'pdf' }>) => Promise<string[]>
}

export function mergeExtractions(parts: readonly Extraction[]): Extraction {
  const sources = [...new Set(parts.map((p) => p.source))]
  return {
    source: sources.length === 1 ? sources[0] : (sources.find((s) => s !== 'other' && s !== 'portfolio') ?? sources[0] ?? 'other'),
    rows: parts.flatMap((p) => p.rows),
    statedTotal: parts.length === 1 ? parts[0].statedTotal : null,
    statedTotalCurrency: parts.length === 1 ? parts[0].statedTotalCurrency : null,
    costIncludesFees: null,
    problems: [...new Set(parts.flatMap((p) => p.problems))],
  }
}

// Reads everything on the device and costs nothing: CSV exactly, PDFs from their text layer, pictures with OCR.
export function createLocalReader(steps: LocalReaderSteps = { recognize: recognizeImage, pdfLines }): AiReader {
  return {
    async read(files, _today, signal) {
      const parts: Extraction[] = []
      for (const file of files) {
        signal?.throwIfAborted()
        if (file.kind === 'text') parts.push(readCsv(file.data))
        else if (file.kind === 'pdf') parts.push(rowsFromLines(await steps.pdfLines(file)))
        else parts.push(rowsFromLines((await steps.recognize(file, signal)).split(/\r?\n/)))
      }
      return mergeExtractions(parts)
    },
    async test() {},
  }
}
