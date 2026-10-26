// Rectangles are fractions of the picture (0 to 1), so they survive the picture being shown at any size.
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = clamp(Math.min(a.x, b.x))
  const y = clamp(Math.min(a.y, b.y))
  return { x, y, w: clamp(Math.max(a.x, b.x)) - x, h: clamp(Math.max(a.y, b.y)) - y }
}

// A tap rather than a drag makes a sliver; anything under 1% either way is taken as a slip.
export function isUsable(rect: Rect): boolean {
  return rect.w >= 0.01 && rect.h >= 0.01
}

export interface EditPlan {
  source: { x: number; y: number; w: number; h: number }
  boxes: { x: number; y: number; w: number; h: number }[]
}

// Turns the crop and the covers into pixels of the output picture: a cover outside the crop is dropped, one across its
// edge is cut to fit.
export function planEdit(width: number, height: number, crop: Rect | null, covers: readonly Rect[]): EditPlan {
  const area = crop && isUsable(crop) ? crop : { x: 0, y: 0, w: 1, h: 1 }
  const source = { x: Math.round(area.x * width), y: Math.round(area.y * height), w: Math.round(area.w * width), h: Math.round(area.h * height) }
  const boxes = covers.flatMap((c) => {
    const left = Math.max(c.x, area.x)
    const top = Math.max(c.y, area.y)
    const right = Math.min(c.x + c.w, area.x + area.w)
    const bottom = Math.min(c.y + c.h, area.y + area.h)
    if (right <= left || bottom <= top) return []
    return [
      {
        x: Math.round((left - area.x) * width),
        y: Math.round((top - area.y) * height),
        w: Math.round((right - left) * width),
        h: Math.round((bottom - top) * height),
      },
    ]
  })
  return { source, boxes }
}

// Draws the cropped picture with solid covers, so what is hidden is gone from the file, not just painted over on screen.
export async function renderEdit(previewUrl: string, name: string, crop: Rect | null, covers: readonly Rect[]): Promise<File> {
  const image = new Image()
  image.src = previewUrl
  await image.decode()
  const plan = planEdit(image.naturalWidth, image.naturalHeight, crop, covers)
  const canvas = document.createElement('canvas')
  canvas.width = plan.source.w
  canvas.height = plan.source.h
  const g = canvas.getContext('2d')!
  g.drawImage(image, plan.source.x, plan.source.y, plan.source.w, plan.source.h, 0, 0, plan.source.w, plan.source.h)
  g.fillStyle = '#000'
  for (const box of plan.boxes) g.fillRect(box.x, box.y, box.w, box.h)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แก้รูปไม่สำเร็จ'))), 'image/png'))
  return new File([blob], name.replace(/\.\w+$/, '') + '.png', { type: 'image/png' })
}
