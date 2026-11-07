import { useRef, useState, type PointerEvent } from 'react'
import { isUsable, rectBetween, renderEdit, type Rect } from '../../../ai/imageEdit'
import { Button } from '../../../components/ui/button'
import { Segmented } from '../../../components/ui/segmented'
import { t } from '../../../i18n'

type Tool = 'cover' | 'crop'
const TOOL_LABELS: Record<Tool, string> = { cover: t('ปิดข้อมูล'), crop: t('ครอป') }

const pct = (n: number) => `${n * 100}%`

export function ImageEditor({
  previewUrl,
  name,
  onApply,
  onCancel,
}: {
  previewUrl: string
  name: string
  onApply: (file: File) => Promise<void>
  onCancel: () => void
}) {
  const [tool, setTool] = useState<Tool>('cover')
  const [covers, setCovers] = useState<Rect[]>([])
  const [crop, setCrop] = useState<Rect | null>(null)
  const [drawing, setDrawing] = useState<Rect | null>(null)
  const [busy, setBusy] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  function point(event: PointerEvent): { x: number; y: number } {
    const box = frame.current!.getBoundingClientRect()
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  function finish() {
    if (drawing && isUsable(drawing)) {
      if (tool === 'crop') setCrop(drawing)
      else setCovers((current) => [...current, drawing])
    }
    start.current = null
    setDrawing(null)
  }

  async function apply() {
    setBusy(true)
    try {
      await onApply(await renderEdit(previewUrl, name, crop, covers))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border bg-background p-3">
      <Segmented label={t('เครื่องมือแก้รูป')} options={(['cover', 'crop'] as const).map((value) => ({ value, label: TOOL_LABELS[value] }))} value={tool} onChange={setTool} />
      <p className="text-[13px] text-muted-foreground">
        {tool === 'cover' ? t('ลากคลุมเลขบัญชี ชื่อ หรือสิ่งที่ไม่อยากให้อ่าน ส่วนที่ปิดจะถูกลบออกจากรูปจริง') : t('ลากกรอบส่วนที่จะเก็บไว้')}
      </p>
      <div
        ref={frame}
        className="relative mx-auto w-full max-w-md touch-none select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = point(e)
          setDrawing(rectBetween(start.current, start.current))
        }}
        onPointerMove={(e) => start.current && setDrawing(rectBetween(start.current, point(e)))}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <img src={previewUrl} alt={t('แก้ {0}', name)} className="block w-full rounded-lg" draggable={false} />
        {crop && (
          <div
            aria-hidden
            className="pointer-events-none absolute border-2 border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]"
            style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
          />
        )}
        {covers.map((c, i) => (
          <div key={i} aria-hidden className="pointer-events-none absolute bg-black" style={{ left: pct(c.x), top: pct(c.y), width: pct(c.w), height: pct(c.h) }} />
        ))}
        {drawing && (
          <div
            aria-hidden
            className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/20"
            style={{ left: pct(drawing.x), top: pct(drawing.y), width: pct(drawing.w), height: pct(drawing.h) }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || (!crop && covers.length === 0)} onClick={() => void apply()}>
          {t('ใช้รูปนี้')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!crop && covers.length === 0}
          onClick={() => {
            setCovers([])
            setCrop(null)
          }}
        >
          {t('ล้าง')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('ยกเลิก')}
        </Button>
      </div>
    </div>
  )
}
