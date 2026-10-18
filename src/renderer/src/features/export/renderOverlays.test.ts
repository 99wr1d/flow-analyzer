import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../../shared/annotations'
import { buildOverlaySvg } from './renderOverlays'

const style = { color: '#ff3b30', width: 0.01, dash: 'solid' as const }
const timing = { mode: 'range' as const, start: 0, duration: 3 }
const arrow: Annotation = {
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  type: 'arrow',
  p1: { x: 0.1, y: 0.2 },
  p2: { x: 0.6, y: 0.4 },
  style,
  timing
}
const text: Annotation = {
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c12',
  type: 'text',
  pos: { x: 0.2, y: 0.3 },
  text: 'Игрок <7> & «пас»',
  style: { color: '#ffffff', size: 0.05, background: true },
  timing
}

describe('buildOverlaySvg: рисунки как SVG в размер видео', () => {
  it('размер, слои по порядку и координаты в пикселях видео', () => {
    const svg = buildOverlaySvg([arrow, text], 1920, 1080)
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"')
    ).toBe(true)
    expect(svg).toContain('viewBox="0 0 1920 1080"')
    expect(svg.indexOf('data-type="arrow"')).toBeLessThan(svg.indexOf('data-type="text"'))
    // Начало стрелки: 0.1 × 1920 = 192, 0.2 × 1080 = 216; толщина 0.01 × 1080 = 10.8.
    expect(svg).toContain('x1="192"')
    expect(svg).toContain('y1="216"')
    expect(svg).toContain('stroke-width="10.8"')
    expect(svg).toContain('<polygon')
  })

  it('тени масштабируются вместе с кадром, ручек выделения нет', () => {
    const small = buildOverlaySvg([arrow], 560, 560)
    const big = buildOverlaySvg([arrow], 1120, 1120)
    expect(small).toContain('drop-shadow(0 1px 2.5px')
    expect(big).toContain('drop-shadow(0 2px 5px')
    expect(small).not.toContain('data-handle')
    expect(small).toContain('data-selected="false"')
  })

  it('текст экранируется: SVG остаётся корректным XML', () => {
    const svg = buildOverlaySvg([text], 640, 360)
    expect(svg).not.toContain('<7>')
    expect(svg).toContain('&lt;7&gt;')
    expect(svg).toContain('&amp;')
    expect(svg).toContain('paint-order')
  })
})
