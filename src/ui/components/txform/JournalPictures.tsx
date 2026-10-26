import { useLiveQuery } from 'dexie-react-hooks'
import { ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Button } from '../../../components/ui/button'
import { db } from '../../../db/db'
import { deletePicture } from '../../../db/repo'

function Thumb({ blob, label, onRemove }: { blob: Blob; label: string; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <li className="relative">
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={label} className="size-20 rounded-lg border object-cover" />
      </a>
      <Button type="button" variant="ghost" size="icon" aria-label={`ลบรูป ${label}`} className="absolute -top-2 -right-2 size-8 rounded-full bg-card shadow" onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </li>
  )
}

// Pictures picked before the trade is saved wait in pending and are written with it.
export function JournalPictures({ txId, pending, setPending }: { txId?: string; pending: File[]; setPending: (files: File[]) => void }) {
  const saved = useLiveQuery(() => (txId ? db.pictures.where('txId').equals(txId).sortBy('createdAt') : []), [txId])
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="grid gap-2">
      <span className="text-[13.5px] font-semibold text-ink-2">รูปประกอบ (ไม่บังคับ)</span>
      <ul className="flex flex-wrap gap-3" aria-label="รูปประกอบเทรด">
        {(saved ?? []).map((p) => (
          <Thumb key={p.id} blob={p.blob} label={p.name} onRemove={() => void deletePicture(db, p.id)} />
        ))}
        {pending.map((file, i) => (
          <Thumb key={`${file.name}-${i}`} blob={file} label={file.name} onRemove={() => setPending(pending.filter((_, j) => j !== i))} />
        ))}
        <li>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="grid size-20 place-items-center rounded-lg border-2 border-dashed text-muted-foreground hover:bg-muted"
            aria-label="แนบรูป"
          >
            <ImagePlus className="size-6" aria-hidden />
          </button>
        </li>
      </ul>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label="เลือกรูปประกอบ"
        onChange={(e) => {
          setPending([...pending, ...Array.from(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <span className="text-[12px] text-muted-foreground">เช่น กราฟตอนเข้า · รูปเก็บในเครื่องนี้ ไม่รวมในไฟล์สำรอง</span>
    </div>
  )
}
