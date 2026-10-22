import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../../shared/annotations'
import { sampleCalibration } from '../../../../shared/pitch/pitch.testkit'
import { GLOW_ALPHA, GLOW_LAYERS } from '../../../../shared/styleFx'
import { buildOverlaySvg, layersFor } from './renderOverlays'

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

describe('слои «под игроками»: что попадает на какую картинку', () => {
  const cal = sampleCalibration()
  const ground = { space: 'pitch' as const, calibrationId: cal.id }
  const frameTiming = { mode: 'frame' as const, start: 12, freezeSeconds: 3 }
  const id = (n: number): string => `3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c${n}`
  const ring: Annotation = {
    id: id(31),
    ...ground,
    type: 'ring',
    center: { x: 8, y: 34 },
    radius: 1.5,
    style,
    timing: frameTiming
  }
  const ruler: Annotation = {
    id: id(32),
    ...ground,
    type: 'ruler',
    p1: { x: 0, y: 13.84 },
    p2: { x: 0, y: 54.16 },
    style,
    timing: frameTiming
  }
  const spot: Annotation = {
    id: id(33),
    ...ground,
    type: 'pspot',
    center: { x: 8, y: 34 },
    radius: 2.5,
    dim: 0.5,
    beam: true,
    style,
    timing: frameTiming
  }
  const zone: Annotation = {
    id: id(34),
    ...ground,
    type: 'pzone',
    points: [
      { x: 2, y: 20 },
      { x: 12, y: 20 },
      { x: 12, y: 30 },
      { x: 2, y: 30 }
    ],
    opacity: 0.3,
    showArea: true,
    style,
    timing: frameTiming
  }
  const under = (a: Annotation, size = 1280): string =>
    buildOverlaySvg([a], size, 720, [cal], { part: 'under' })
  const over = (a: Annotation, size = 1280): string =>
    buildOverlaySvg([a], size, 720, [cal], { part: 'over' })

  it('кольцо: на «под игроками» — диск и контур, на «поверх» ничего из рисунка', () => {
    expect(under(ring)).toContain('data-part="disc"')
    expect(under(ring)).toContain('data-part="body"')
    expect(over(ring)).not.toContain('data-part="disc"')
    expect(over(ring)).not.toContain('data-part="body"')
  })

  it('линейка: линия — под игроками, подпись «м» — всегда поверх', () => {
    expect(under(ruler)).toContain('data-part="body"')
    expect(under(ruler)).not.toContain('ruler-label')
    expect(over(ruler)).toContain('ruler-label')
    expect(over(ruler)).toContain('40.3 м')
    expect(over(ruler)).not.toContain('data-part="body"')
  })

  it('зона: заливка и контур — под игроками, подпись площади — поверх', () => {
    expect(under(zone)).toContain('data-part="fill"')
    expect(under(zone)).not.toContain('area-label')
    expect(over(zone)).toContain('area-label')
    expect(over(zone)).not.toContain('data-part="fill"')
  })

  it('прожектор на траве: затемнение и луч поверх (не ключуются), кольцо и диск — под игроками', () => {
    const u = under(spot)
    const o = over(spot)
    expect(u).toContain('data-part="disc"')
    expect(u).not.toContain('spotlight-dim')
    expect(u).not.toContain('data-part="beam"')
    expect(o).toContain('spotlight-dim')
    expect(o).toContain('data-part="beam"')
    expect(o).not.toContain('data-part="disc"')
  })

  it('рисунок на экране по умолчанию целиком на «поверх»; положенный под игроков — на «под игроками»', () => {
    const arrowUnder: Annotation = { ...arrow, underPlayers: true }
    expect(buildOverlaySvg([arrow], 640, 360, [], { part: 'under' })).not.toContain('<line')
    expect(buildOverlaySvg([arrow], 640, 360, [], { part: 'over' })).toContain('<line')
    expect(buildOverlaySvg([arrowUnder], 640, 360, [], { part: 'under' })).toContain('<line')
    expect(buildOverlaySvg([arrowUnder], 640, 360, [], { part: 'over' })).not.toContain('<line')
    // Подпись на экране никогда не уходит вниз, даже если в файле стоит underPlayers.
    const textUnder = { ...text, underPlayers: true } as Annotation
    expect(buildOverlaySvg([textUnder], 640, 360, [], { part: 'under' })).not.toContain('Игрок')
    expect(buildOverlaySvg([textUnder], 640, 360, [], { part: 'over' })).toContain('Игрок')
  })

  it('масштаб растра: размер картинки больше, система координат прежняя', () => {
    const svg = buildOverlaySvg([ring], 640, 360, [cal], { part: 'under', scale: 2 })
    expect(svg).toContain('width="1280" height="720"')
    expect(svg).toContain('viewBox="0 0 640 360"')
  })

  it('layersFor: какие слои нужны набору рисунков', () => {
    expect(layersFor([arrow])).toEqual({ under: false, over: true })
    expect(layersFor([ring])).toEqual({ under: true, over: false })
    expect(layersFor([ring, arrow])).toEqual({ under: true, over: true })
    // У линейки, зоны, связей и прожектора есть часть, которая всегда поверх.
    expect(layersFor([ruler])).toEqual({ under: true, over: true })
    expect(layersFor([zone])).toEqual({ under: true, over: true })
    expect(layersFor([spot])).toEqual({ under: true, over: true })
    expect(layersFor([text])).toEqual({ under: false, over: true })
  })

  it('порядок слоёв сохраняется: «поверх» содержит рисунки в порядке набора', () => {
    const svg = buildOverlaySvg([arrow, ruler], 1280, 720, [cal], { part: 'over' })
    expect(svg.indexOf('data-type="arrow"')).toBeLessThan(svg.indexOf('data-type="ruler"'))
  })
})

describe('экспорт: прожектор на экране с лучом (после слежения за игроком)', () => {
  const spot = (beam?: boolean): Annotation => ({
    id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c77',
    space: 'screen',
    type: 'spot',
    p1: { x: 0.4, y: 0.6 },
    p2: { x: 0.5, y: 0.7 },
    dim: 0.5,
    ...(beam === undefined ? {} : { beam }),
    style,
    timing
  })

  it('с лучом в кадре есть градиентный луч, без луча — нет', () => {
    expect(buildOverlaySvg([spot(true)], 1280, 720)).toContain('data-part="beam"')
    expect(buildOverlaySvg([spot()], 1280, 720)).not.toContain('data-part="beam"')
  })

  it('затемнение с лучом освещает весь луч (выше эллипса)', () => {
    const withBeam = buildOverlaySvg([spot(true)], 1000, 500)
    const plain = buildOverlaySvg([spot()], 1000, 500)
    expect(withBeam).not.toEqual(plain)
    expect(withBeam).toContain('data-testid="spotlight-dim"')
  })
})

describe('свечение кольца', () => {
  const cal = sampleCalibration()
  const tid = (n: number): string => `3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d${n}`
  const circle = (over: object = {}): Annotation =>
    ({
      id: tid(1),
      space: 'screen',
      type: 'circle',
      p1: { x: 0.4, y: 0.5 },
      p2: { x: 0.5, y: 0.55 },
      style: { color: '#2e8bff', width: 0.006, dash: 'solid' },
      fillOpacity: 0,
      underPlayers: true,
      timing,
      ...over
    }) as Annotation
  const ring = (over: object = {}): Annotation =>
    ({
      id: tid(2),
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ring',
      center: { x: 8, y: 34 },
      radius: 1.5,
      style: { color: '#2e8bff', width: 0.006, dash: 'solid' },
      fillOpacity: 0,
      underPlayers: true,
      timing: { mode: 'frame', start: 12, freezeSeconds: 3 },
      ...over
    }) as Annotation
  const glowCount = (svg: string): number => (svg.match(/data-part="glow"/g) ?? []).length

  it('круг со свечением: стопка полупрозрачных слоёв того же цвета под обводкой, без тени', () => {
    const svg = buildOverlaySvg([circle({ glow: true })], 1280, 720)
    expect(glowCount(svg)).toBe(GLOW_LAYERS)
    expect(svg).toContain('data-glow="true"')
    expect(svg).not.toContain('class="anno-shape')
    // Слои идут раньше самой обводки и повторяют её цвет.
    const firstGlow = svg.indexOf('data-part="glow"')
    expect(firstGlow).toBeGreaterThan(0)
    expect(svg.indexOf('data-part="core"')).toBeGreaterThan(firstGlow)
    const layer = svg.match(/<ellipse[^>]*data-part="glow"[^>]*>/)![0]
    expect(layer).toContain('stroke="#2e8bff"')
    expect(layer).toContain(`stroke-opacity="${GLOW_ALPHA}"`)
    expect(layer).toContain('fill="none"')
  })

  it('старый круг без поля glow — без ореола и с прежней тенью', () => {
    const svg = buildOverlaySvg([circle()], 1280, 720)
    expect(glowCount(svg)).toBe(0)
    expect(svg).not.toContain('data-glow')
    expect(svg).toContain('class="anno-shape')
  })

  it('glow: false — тоже без ореола', () => {
    expect(glowCount(buildOverlaySvg([circle({ glow: false })], 1280, 720))).toBe(0)
  })

  it('кольцо на поле со свечением: ореол вдоль кромок, у старого кольца нет', () => {
    const on = buildOverlaySvg([ring({ glow: true })], 1280, 720, [cal])
    expect(glowCount(on)).toBeGreaterThanOrEqual(GLOW_LAYERS)
    expect(on).not.toContain('class="anno-shape')
    expect(buildOverlaySvg([ring()], 1280, 720, [cal])).not.toContain('data-part="glow"')
  })

  it('ореол кольца «под игроками» лежит на слое травы, а не поверх игроков', () => {
    const items = [ring({ glow: true }), circle({ glow: true })]
    const under = buildOverlaySvg(items, 1280, 720, [cal], { part: 'under' })
    const over = buildOverlaySvg(items, 1280, 720, [cal], { part: 'over' })
    expect(glowCount(under)).toBeGreaterThan(GLOW_LAYERS)
    expect(glowCount(over)).toBe(0)
  })
})

describe('свечение пунктирного круга', () => {
  it('слои ореола повторяют пунктир обводки', () => {
    const svg = buildOverlaySvg(
      [
        {
          id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d91',
          space: 'screen',
          type: 'circle',
          p1: { x: 0.4, y: 0.5 },
          p2: { x: 0.5, y: 0.55 },
          style: { color: '#2e8bff', width: 0.006, dash: 'dashed' },
          fillOpacity: 0,
          glow: true,
          timing
        } as Annotation
      ],
      1280,
      720
    )
    const layer = svg.match(/<ellipse[^>]*data-part="glow"[^>]*>/)![0]
    expect(layer).toContain('stroke-dasharray=')
  })
})
