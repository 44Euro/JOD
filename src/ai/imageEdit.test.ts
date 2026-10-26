import { describe, expect, it } from 'vitest'
import { isUsable, planEdit, rectBetween } from './imageEdit'

describe('rectBetween', () => {
  it('works whichever way the finger dragged and stays inside the picture', () => {
    const near = (r: { x: number; y: number; w: number; h: number }) => [r.x, r.y, r.w, r.h].map((n) => Math.round(n * 1000) / 1000)
    expect(near(rectBetween({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 }))).toEqual([0.2, 0.1, 0.4, 0.4])
    expect(near(rectBetween({ x: -0.2, y: 0.9 }, { x: 0.5, y: 1.4 }))).toEqual([0, 0.9, 0.5, 0.1])
  })

  it('takes a tap for a slip', () => {
    expect(isUsable({ x: 0.5, y: 0.5, w: 0.005, h: 0.3 })).toBe(false)
  })
})

describe('planEdit', () => {
  it('covers whole-picture boxes in pixels when nothing is cropped', () => {
    expect(planEdit(1000, 2000, null, [{ x: 0.1, y: 0.05, w: 0.5, h: 0.02 }])).toEqual({
      source: { x: 0, y: 0, w: 1000, h: 2000 },
      boxes: [{ x: 100, y: 100, w: 500, h: 40 }],
    })
  })

  it('moves covers into the crop, cuts one across its edge and drops one outside it', () => {
    const plan = planEdit(1000, 1000, { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, [
      { x: 0.1, y: 0.3, w: 0.2, h: 0.1 },
      { x: 0.8, y: 0.8, w: 0.1, h: 0.1 },
    ])
    expect(plan.source).toEqual({ x: 200, y: 200, w: 500, h: 500 })
    expect(plan.boxes).toEqual([{ x: 0, y: 100, w: 100, h: 100 }])
  })
})
