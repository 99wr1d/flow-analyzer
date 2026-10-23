import { describe, expect, it } from 'vitest'
import { BOARD_VIDEO_FPS } from '../../../../shared/board/ipc'
import { newBoard, type Board, type BoardElement } from '../../../../shared/board/schema'
import { EXPORT_H, EXPORT_W, buildBoardSvg, renderBoardVideoFrames } from './boardRender'

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ball: BoardElement = {
  kind: 'equip',
  item: 'ball',
  pos: { x: 0.3, y: 0.5 },
  scale: 1,
  rotation: 0,
  color: '#ffffff'
}
const hatch = (color: string): BoardElement => ({
  kind: 'hatch',
  shape: 'rect',
  p1: { x: 0.2, y: 0.2 },
  p2: { x: 0.5, y: 0.5 },
  color
})
const boardWith = (items: Board['items'], frameCount = 2, transition = 1): Board => ({
  ...newBoard('t', new Date(0)),
  frameCount,
  transition,
  items
})

describe('buildBoardSvg', () => {
  it('задаёт размер, xmlns и признак сцены', () => {
    const svg = buildBoardSvg(boardWith([]), { frame: 0 })
    expect(EXPORT_W).toBe(1920)
    expect(EXPORT_H).toBe(1080)
    expect(BOARD_VIDEO_FPS).toBe(30)
    expect(svg).toContain('width="1920"')
    expect(svg).toContain('height="1080"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 1600 900"')
    expect(svg).toContain('data-board-scene')
    expect(svg).toContain('data-frame="0"')
    expect(buildBoardSvg(boardWith([]), { time: 1.25 })).toContain('data-time="1.25"')
  })

  it('мяч с show {1,1} появляется только в кадре 1', () => {
    const b = boardWith([{ id: uuid(1), show: { from: 1, to: 1 }, el: ball, states: [] }])
    expect(buildBoardSvg(b, { frame: 0 })).not.toContain('data-kind="equip"')
    expect(buildBoardSvg(b, { frame: 1 })).toContain('data-kind="equip"')
  })

  it('две штриховки: разные id шаблонов, все url(#…) разрешаются', () => {
    const b = boardWith([
      { id: uuid(1), show: { from: 0, to: 1 }, el: hatch('#ff0000'), states: [] },
      { id: uuid(2), show: { from: 0, to: 1 }, el: hatch('#0000ff'), states: [] }
    ])
    const svg = buildBoardSvg(b, { frame: 0 })
    const patterns = [...svg.matchAll(/<pattern[^>]*\sid="([^"]+)"/g)].map((m) => m[1])
    expect(patterns.length).toBe(2)
    expect(new Set(patterns).size).toBe(2)
    const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(r).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(ids.has(r)).toBe(true)
    }
  })
})

describe('renderBoardVideoFrames', () => {
  it('отдаёт ceil(duration*fps) кадров и растеризует повторы один раз', async () => {
    const b = boardWith([{ id: uuid(1), show: { from: 1, to: 1 }, el: ball, states: [] }])
    let calls = 0
    const rasterize = async (): Promise<Uint8Array> => {
      calls++
      return new Uint8Array([calls])
    }
    const out: number[] = []
    for await (const f of renderBoardVideoFrames(b, { rasterize })) out.push(f.index)
    expect(out.length).toBe(75)
    expect(out).toEqual(Array.from({ length: 75 }, (_, i) => i))
    expect(calls).toBeLessThan(75)
    expect(calls).toBeGreaterThan(1)
  })

  it('останавливается по сигналу', async () => {
    const ac = new AbortController()
    ac.abort()
    const it = renderBoardVideoFrames(boardWith([]), {
      signal: ac.signal,
      rasterize: async () => new Uint8Array(1)
    })
    await expect(it.next()).rejects.toThrow()
  })
})
