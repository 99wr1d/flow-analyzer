import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../../shared/annotations'
import { sampleCalibration } from '../../../../shared/pitch/pitch.testkit'
import { buildOverlaySvg } from './renderOverlays'

const style = { color: '#ff3b30', width: 0.01, dash: 'solid' as const }
const timing = { mode: 'range' as const, start: 0, duration: 3 }
const arrow: Annotation = {
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  space: 'screen',
  type: 'arrow',
  p1: { x: 0.1, y: 0.2 },
  p2: { x: 0.6, y: 0.4 },
  style,
  timing
}
const text: Annotation = {
  id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c12',
  space: 'screen',
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

  describe('рисунки на поле', () => {
    const cal = sampleCalibration()
    const ring: Annotation = {
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c21',
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ring',
      center: { x: 8, y: 34 },
      radius: 1.5,
      style,
      timing: { mode: 'frame', start: 12, freezeSeconds: 3 }
    }
    const ruler: Annotation = {
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c22',
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ruler',
      p1: { x: 0, y: 13.84 },
      p2: { x: 0, y: 54.16 },
      style,
      timing: { mode: 'frame', start: 12, freezeSeconds: 3 }
    }

    it('кольцо и линейка в перспективе: пути в пикселях видео и подпись в метрах', () => {
      const svg = buildOverlaySvg([ring, ruler], 1920, 1080, [cal])
      expect(svg).toContain('data-type="ring"')
      expect(svg).toContain('data-part="disc"')
      expect(svg).toContain('data-part="body"')
      expect(svg).toContain('40.3 м')
      expect(svg).toContain('data-space="pitch"')
      // Координаты в пределах кадра 1920×1080 (в долях кадра они были бы < 1).
      const nums = [...svg.matchAll(/M([\d.]+),([\d.]+)/g)].map((m) => Number(m[1]))
      expect(nums.some((n) => n > 5)).toBe(true)
    })

    it('без разметки рисунок на поле не рисуется', () => {
      const svg = buildOverlaySvg([ring], 1920, 1080, [])
      expect(svg).not.toContain('data-type="ring"')
    })

    it('далеко от кадра разметки рисунок бледнеет', () => {
      const near = buildOverlaySvg([ring], 1920, 1080, [cal])
      const far = buildOverlaySvg([ring], 1920, 1080, [{ ...cal, time: 2 }])
      expect(near).not.toContain('opacity="0.5"')
      expect(far).toContain('opacity="0.5"')
    })
  })
})
