import { describe, expect, it } from 'vitest'
import { resolveAt } from '../../../../shared/animation'
import type { Annotation } from '../../../../shared/annotations'
import { sampleCalibration } from '../../../../shared/pitch/pitch.testkit'
import {
  GLOW_ALPHA,
  GLOW_LAYERS,
  PULSE_STEPS,
  TARGET_CENTER_ALPHA
} from '../../../../shared/styleFx'
import { BoundedCache, buildOverlaySvg, layersFor, phaseKeyOf } from './renderOverlays'

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

describe('buildOverlaySvg: жирность подписи', () => {
  const lbl = (style: object): Annotation =>
    ({ ...text, text: 'LW', style: { color: '#ffffff', size: 0.05, ...style } }) as Annotation
  it('старая подпись (с плашкой и без поля shadow) — 700, новая (поле shadow) — 600, с плашкой тоже', () => {
    expect(buildOverlaySvg([lbl({ background: true })], 1280, 720)).toContain('font-weight="700"')
    expect(buildOverlaySvg([lbl({ background: false })], 1280, 720)).toContain('font-weight="700"')
    expect(buildOverlaySvg([lbl({ background: true, shadow: true })], 1280, 720)).toContain(
      'font-weight="600"'
    )
    expect(buildOverlaySvg([lbl({ background: false, shadow: false })], 1280, 720)).toContain(
      'font-weight="600"'
    )
  })
})

describe('buildOverlaySvg: подписи без плашки', () => {
  const label = (style: object): Annotation =>
    ({ ...text, text: 'LW', style: { color: '#c6ff3d', size: 0.05, ...style } }) as Annotation

  it('новая подпись: без плашки, тень стопкой тёмных копий, без контура и общей тени группы', () => {
    const svg = buildOverlaySvg([label({ background: false, shadow: true })], 1280, 720)
    expect(svg).not.toContain('<rect')
    expect(svg.match(/data-part="text-shadow"/g)!.length).toBeGreaterThanOrEqual(2)
    // Новая подпись легче прежней (600), старая (без поля shadow) осталась 700.
    expect(svg).toContain('font-weight="600"')
    expect(svg).not.toContain('font-weight="700"')
    expect(svg).not.toContain('paint-order')
    expect(svg).not.toContain('class="anno-shape')
  })

  it('старая подпись с плашкой выглядит как раньше: плашка и общая тень, без слоёв тени', () => {
    const svg = buildOverlaySvg([label({ background: true })], 1280, 720)
    expect(svg).toContain('<rect')
    expect(svg).not.toContain('text-shadow')
    expect(svg).toContain('class="anno-shape')
  })

  it('старая подпись без плашки и без поля shadow — прежний контур', () => {
    const svg = buildOverlaySvg([label({ background: false })], 1280, 720)
    expect(svg).not.toContain('<rect')
    expect(svg).not.toContain('text-shadow')
    expect(svg).toContain('paint-order="stroke"')
  })

  it('подпись без плашки и без тени — голый текст', () => {
    const svg = buildOverlaySvg([label({ background: false, shadow: false })], 1280, 720)
    expect(svg).not.toContain('text-shadow')
    expect(svg).not.toContain('stroke=')
    expect(svg).not.toContain('class="anno-shape')
  })
})

describe('buildOverlaySvg: мишень и пульс', () => {
  const cal = sampleCalibration()
  const tid = (n: number): string =>
    `3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d${String(n).padStart(2, '0')}`
  const circle = (over: object = {}): Annotation =>
    ({
      id: tid(11),
      space: 'screen',
      type: 'circle',
      p1: { x: 0.4, y: 0.5 },
      p2: { x: 0.5, y: 0.6 },
      style: { color: '#ff5a1f', width: 0.004, dash: 'solid' },
      fillOpacity: 0,
      look: 'target',
      timing,
      ...over
    }) as Annotation
  const ring = (over: object = {}): Annotation =>
    ({
      id: tid(12),
      space: 'pitch',
      calibrationId: cal.id,
      type: 'ring',
      center: { x: 8, y: 34 },
      radius: 1.5,
      style: { color: '#ff5a1f', width: 0.004, dash: 'solid' },
      fillOpacity: 0,
      look: 'target',
      timing,
      ...over
    }) as Annotation
  const rings = (svg: string): number => (svg.match(/data-part="core"/g) ?? []).length
  const waves = (svg: string): number => (svg.match(/data-part="wave"/g) ?? []).length

  it('круг-мишень: три кольца (1, 0.66, 0.33) и радиальная заливка от ~35% в центре к нулю', () => {
    const svg = buildOverlaySvg([circle()], 1000, 1000)
    expect(rings(svg)).toBe(3)
    const rx = (k: number): string => `rx="${Math.round(50 * k * 1e6) / 1e6}"`
    for (const k of [1, 0.66, 0.33]) expect(svg).toContain(rx(k))
    expect(svg).toMatch(/<radialGradient id="target-[^"]+"><stop offset="0"[^>]*stop-opacity="1"/)
    expect(svg).toMatch(/<stop offset="1"[^>]*stop-opacity="0"/)
    expect(svg).toContain(`fill-opacity="${TARGET_CENTER_ALPHA}"`)
    expect(TARGET_CENTER_ALPHA).toBeGreaterThanOrEqual(0.3)
    expect(TARGET_CENTER_ALPHA).toBeLessThanOrEqual(0.6)
  })

  it('круг без look — одно кольцо, как раньше (без градиента)', () => {
    const svg = buildOverlaySvg([circle({ look: undefined })], 1000, 1000)
    expect(rings(svg)).toBe(1)
    expect(svg).not.toContain('radialGradient')
  })

  it('кольцо на поле — мишень: три полосы вместо одной и градиентная заливка диска', () => {
    const one = buildOverlaySvg([ring({ look: 'ring' })], 1280, 720, [cal])
    const target = buildOverlaySvg([ring()], 1280, 720, [cal])
    const bodies = (s: string): number => (s.match(/<path data-part="body"/g) ?? []).length
    expect(bodies(one)).toBe(1)
    expect(bodies(target)).toBe(3)
    expect(target).toMatch(/<radialGradient id="target-/)
    expect(target).toMatch(/data-part="disc"[^>]*fill="url\(#target-/)
    expect(one).not.toContain('radialGradient')
  })

  it('пульс: круг — волна в момент t зависит только от t, в разные моменты разная', () => {
    const a = circle({ pulse: true })
    const at = (t: number): string => buildOverlaySvg([a], 1000, 1000, [], { time: t })
    expect(waves(at(0.5))).toBe(1)
    expect(at(0.5)).toBe(at(0.5))
    expect(at(0.5)).not.toBe(at(1.0))
    // Период 1.5 с: t и t + 1.5 дают одну и ту же картинку.
    expect(at(0.3)).toBe(at(1.8))
  })

  it('пульс: кольцо на поле — волна есть, в разные моменты разная; без времени и без pulse волны нет', () => {
    const a = ring({ pulse: true })
    const at = (t?: number): string => buildOverlaySvg([a], 1280, 720, [cal], { time: t })
    expect(waves(at(0.4))).toBe(1)
    expect(at(0.4)).not.toBe(at(0.9))
    expect(waves(at(undefined))).toBe(0)
    expect(waves(buildOverlaySvg([ring()], 1280, 720, [cal], { time: 0.4 }))).toBe(0)
  })

  it('пульс у простого кольца (не мишени) тоже даёт волну', () => {
    const svg = buildOverlaySvg([circle({ look: 'ring', pulse: true })], 1000, 1000, [], {
      time: 0.7
    })
    expect(waves(svg)).toBe(1)
    expect(rings(svg)).toBe(1)
  })

  it('«только кадр» — стоп-кадр без волны', () => {
    const frameOnly = circle({ pulse: true, timing: { mode: 'frame', start: 1, freezeSeconds: 2 } })
    expect(waves(buildOverlaySvg([frameOnly], 1000, 1000, [], { time: 0.5 }))).toBe(0)
  })

  it('мишень «под игроками» уходит на слой травы целиком, наверху ничего', () => {
    const items = [circle({ underPlayers: true, pulse: true, glow: true })]
    const under = buildOverlaySvg(items, 1000, 1000, [], { part: 'under', time: 0.3 })
    const over = buildOverlaySvg(items, 1000, 1000, [], { part: 'over', time: 0.3 })
    expect(rings(under)).toBe(3)
    expect(waves(under)).toBe(1)
    expect(rings(over)).toBe(0)
    expect(waves(over)).toBe(0)
  })
})

describe('phaseKeyOf: картинки кадров с пульсом повторяются', () => {
  const base = {
    id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4f01',
    space: 'screen',
    type: 'circle',
    p1: { x: 0.4, y: 0.5 },
    p2: { x: 0.5, y: 0.6 },
    style: { color: '#ff5a1f', width: 0.004, dash: 'solid' },
    timing: { mode: 'range', start: 0, duration: 20 }
  }
  const pulsing = { ...base, pulse: true } as Annotation
  const plain = { ...base } as Annotation

  it('одна фаза (t и t + период) — один ключ; другая фаза — другой', () => {
    expect(phaseKeyOf([pulsing], 0.32)).toBe(phaseKeyOf([pulsing], 0.32 + 1.5))
    expect(phaseKeyOf([pulsing], 0.32)).toBe(phaseKeyOf([pulsing], 0.32 + 3 * 1.5))
    expect(phaseKeyOf([pulsing], 0.32)).not.toBe(phaseKeyOf([pulsing], 0.9))
  })

  it('при 29,97 и 59,94 к/с за 10 с не больше PULSE_STEPS разных ключей на слой, и они повторяются', () => {
    for (const fps of [30000 / 1001, 60000 / 1001, 25]) {
      for (const layer of ['over', 'under'] as const) {
        const ann = (layer === 'under' ? { ...pulsing, underPlayers: true } : pulsing) as Annotation
        const keys = new Set<string | null>()
        const frames = Math.floor(10 * fps)
        for (let n = 0; n < frames; n += 1) keys.add(phaseKeyOf([ann], (n + 0.5) / fps, layer))
        expect(keys.size).toBeLessThanOrEqual(PULSE_STEPS)
        expect(keys.has(null)).toBe(false)
        expect(frames / keys.size).toBeGreaterThan(fps > 50 ? 5 : 4)
      }
    }
  })

  it('рисунок без пульса не зависит от времени', () => {
    expect(phaseKeyOf([plain], 0.3)).toBe(phaseKeyOf([plain], 7.1))
  })

  it('кадры разных наборов рисунков не смешиваются', () => {
    const other = { ...pulsing, id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4f02' } as Annotation
    expect(phaseKeyOf([pulsing], 0.3)).not.toBe(phaseKeyOf([other], 0.3))
  })

  it('ключ слоя не зависит от фазы рисунков другого слоя', () => {
    const under = { ...pulsing, underPlayers: true } as Annotation
    const over = { ...arrow, id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4f03' } as Annotation
    // Пульс рисунка «под игроками» меняет только свой слой.
    expect(phaseKeyOf([under, over], 0.3, 'over')).toBe(phaseKeyOf([under, over], 0.9, 'over'))
    expect(phaseKeyOf([under, over], 0.3, 'under')).not.toBe(
      phaseKeyOf([under, over], 0.9, 'under')
    )
  })

  it('рисунок с ключами (движется) кэшировать нельзя', () => {
    const moving = {
      ...pulsing,
      keyframes: [
        { t: 0, geom: { p1: base.p1, p2: base.p2 } },
        { t: 1, geom: { p1: { x: 0.5, y: 0.5 }, p2: { x: 0.6, y: 0.6 } } }
      ]
    } as unknown as Annotation
    expect(phaseKeyOf([moving], 0.3)).toBeNull()
  })
})

describe('BoundedCache', () => {
  it('не растёт выше потолка и выбрасывает самые старые', () => {
    const c = new BoundedCache<number>(3)
    for (let i = 0; i < 10; i += 1) c.set(`k${i}`, i)
    expect(c.size).toBe(3)
    expect(c.get('k0')).toBeUndefined()
    expect(c.get('k9')).toBe(9)
    expect(c.get('k7')).toBe(7)
  })
})

describe('пульс у рисунка «только кадр»: волны нет, даже рядом с другими движущимися', () => {
  const cal = sampleCalibration()
  const frameTiming = { mode: 'frame', start: 1, freezeSeconds: 2 }
  const circle = {
    id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4f11',
    space: 'screen',
    type: 'circle',
    p1: { x: 0.4, y: 0.5 },
    p2: { x: 0.5, y: 0.6 },
    style: { color: '#ff5a1f', width: 0.004, dash: 'solid' },
    pulse: true,
    timing: frameTiming
  } as Annotation
  const ring = {
    id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4f12',
    space: 'pitch',
    calibrationId: cal.id,
    type: 'ring',
    center: { x: 8, y: 34 },
    radius: 1.5,
    style: { color: '#ff5a1f', width: 0.004, dash: 'solid' },
    pulse: true,
    timing: frameTiming
  } as Annotation
  const rangePulse = { ...circle, id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4f13', timing } as Annotation
  const waves = (svg: string): number => (svg.match(/data-part="wave"/g) ?? []).length

  it('в общем кадре с пульсирующим отрезком волна только у отрезка', () => {
    const svg = buildOverlaySvg([circle, ring, rangePulse], 1280, 720, [cal], { time: 0.4 })
    expect(waves(svg)).toBe(1)
  })

  it('ключ кадра у «только кадр» не зависит от времени', () => {
    expect(phaseKeyOf([circle], 0.3)).toBe(phaseKeyOf([circle], 0.9))
    expect(phaseKeyOf([rangePulse], 0.3)).not.toBe(phaseKeyOf([rangePulse], 0.9))
  })
})

describe('пунктир точками (экран и экспорт)', () => {
  const dotted = { color: '#ffffff', width: 0.01, dash: 'dotted' as const }
  const uid = (n: number): string =>
    `3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4e${String(n).padStart(2, '0')}`
  const shapes: Array<[string, object]> = [
    ['arrow', { type: 'arrow', p1: { x: 0.1, y: 0.2 }, p2: { x: 0.6, y: 0.4 } }],
    ['line', { type: 'line', p1: { x: 0.1, y: 0.2 }, p2: { x: 0.6, y: 0.4 } }],
    [
      'curve',
      { type: 'curve', p1: { x: 0.1, y: 0.8 }, p2: { x: 0.5, y: 0.8 }, c: { x: 0.3, y: 0.4 } }
    ],
    [
      'pen',
      {
        type: 'pen',
        arrow: false,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.3 },
          { x: 0.4, y: 0.2 }
        ]
      }
    ],
    [
      'chain',
      {
        type: 'chain',
        fill: false,
        labels: false,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.4 },
          { x: 0.5, y: 0.2 }
        ]
      }
    ]
  ]

  it.each(shapes)(
    '%s: круглые точки (нулевой штрих, круглые концы), шаг ≈ 2.5 толщины',
    (_n, g) => {
      const svg = buildOverlaySvg(
        [{ id: uid(1), space: 'screen', style: dotted, timing, ...g } as Annotation],
        1000,
        500
      )
      const tag = svg.match(/<(?:line|path)[^>]*stroke-dasharray="0\.001 ([\d.]+)"[^>]*>/)
      expect(tag).not.toBeNull()
      expect(tag![0]).toContain('stroke-linecap="round"')
      const step = Number(tag![1]) + 0.001
      const w = 0.01 * 500
      expect(step).toBeGreaterThan(w * 2)
      expect(step).toBeLessThan(w * 3.2)
    }
  )

  it('стрелка: наконечник остаётся сплошным', () => {
    const svg = buildOverlaySvg(
      [{ id: uid(2), space: 'screen', style: dotted, timing, ...shapes[0][1] } as Annotation],
      1000,
      500
    )
    expect(svg.match(/<polygon[^>]*>/)![0]).not.toContain('stroke-dasharray')
  })

  it('короткая линия — хотя бы две точки', () => {
    const svg = buildOverlaySvg(
      [
        {
          id: uid(3),
          space: 'screen',
          type: 'line',
          p1: { x: 0.5, y: 0.5 },
          p2: { x: 0.508, y: 0.5 },
          style: dotted,
          timing
        } as Annotation
      ],
      1000,
      500
    )
    const [dash, gap] = svg
      .match(/stroke-dasharray="([\d. ]+)"/)![1]
      .split(' ')
      .map(Number)
    const len = 0.008 * 1000
    expect(Math.floor(len / (dash + gap)) + 1).toBeGreaterThanOrEqual(2)
  })

  it('свечение круга с точками повторяет штриховку и круглые концы', () => {
    const svg = buildOverlaySvg(
      [
        {
          id: uid(4),
          space: 'screen',
          type: 'circle',
          p1: { x: 0.4, y: 0.5 },
          p2: { x: 0.5, y: 0.6 },
          style: dotted,
          fillOpacity: 0,
          glow: true,
          timing
        } as Annotation
      ],
      1000,
      500
    )
    const layer = svg.match(/<ellipse[^>]*data-part="glow"[^>]*>/)![0]
    expect(layer).toContain('stroke-dasharray="0.001')
    expect(layer).toContain('stroke-linecap="round"')
  })

  it('перо из тысяч точек рисуется быстро', () => {
    const points = Array.from({ length: 1500 }, (_, i) => ({
      x: 0.05 + (i / 1500) * 0.9,
      y: 0.5 + Math.sin(i / 20) * 0.2
    }))
    const pen = {
      id: uid(5),
      space: 'screen',
      type: 'pen',
      arrow: false,
      points,
      style: dotted,
      timing
    } as Annotation
    buildOverlaySvg([pen], 1280, 720)
    const t0 = performance.now()
    buildOverlaySvg([pen], 1280, 720)
    expect(performance.now() - t0).toBeLessThan(50)
  })
})

describe('свечение и проявление линий (экран и экспорт)', () => {
  const uid = (n: number): string =>
    `3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b5a${String(n).padStart(2, '0')}`
  const lime = { color: '#c6ff3d', width: 0.01, dash: 'solid' as const }
  const range = { mode: 'range' as const, start: 4, duration: 6 }
  const geoms: Record<string, object> = {
    arrow: { type: 'arrow', p1: { x: 0.1, y: 0.5 }, p2: { x: 0.9, y: 0.5 } },
    line: { type: 'line', p1: { x: 0.1, y: 0.5 }, p2: { x: 0.9, y: 0.5 } },
    curve: { type: 'curve', p1: { x: 0.1, y: 0.8 }, p2: { x: 0.9, y: 0.8 }, c: { x: 0.5, y: 0.2 } }
  }
  const make = (kind: string, extra: object = {}): Annotation =>
    ({
      id: uid(1),
      space: 'screen',
      style: lime,
      timing: range,
      ...geoms[kind],
      ...extra
    }) as Annotation
  const lineEnd = (svg: string): number =>
    Number(svg.match(/<line[^>]*data-part="line"[^>]*x2="([\d.]+)"/)![1])

  it('свечение стрелки: ореол стопкой слоёв, светлое ядро поверх, без тени группы', () => {
    const svg = buildOverlaySvg([make('arrow', { glow: true })], 1000, 500)
    expect(svg.match(/data-part="glow"/g)!.length).toBeGreaterThanOrEqual(GLOW_LAYERS)
    expect(svg).toContain('data-part="core"')
    expect(svg).not.toContain('class="anno-shape')
    // Ядро светлее цвета линии.
    expect(svg.match(/data-part="core"[^>]*stroke="(#[0-9a-f]{6})"/)![1]).not.toBe('#c6ff3d')
    // Без свечения — прежний вид: ни ореола, ни ядра.
    const plain = buildOverlaySvg([make('arrow')], 1000, 500)
    expect(plain).not.toContain('data-part="glow"')
    expect(plain).not.toContain('data-part="core"')
  })

  it.each(['arrow', 'line'])('%s: путь обрезается по длине, штриховка не нужна', (kind) => {
    const a = make(kind, { reveal: 2 })
    const at = (t: number): string => buildOverlaySvg([a], 1000, 500, [], { time: t })
    expect(at(4)).not.toContain('<line') // начало отрезка: пусто
    const half = lineEnd(at(5))
    const most = lineEnd(at(5.9))
    // (5 − 4) / 2 = половина стержня (у стрелки он короче пути на наконечник).
    expect(half).toBeCloseTo(100 + 0.5 * (lineEnd(at(8)) - 100), 0)
    expect(most).toBeGreaterThan(half)
    expect(at(5)).not.toContain('stroke-dasharray')
    expect(at(8)).toBe(buildOverlaySvg([a], 1000, 500)) // после N — целиком, как без времени
  })

  it('наконечник стрелки появляется, только когда линия дошла до конца', () => {
    const a = make('arrow', { reveal: 2 })
    const at = (t: number): string => buildOverlaySvg([a], 1000, 500, [], { time: t })
    expect(at(5.99)).not.toContain('<polygon')
    expect(at(6)).toContain('<polygon')
  })

  it('точки + свечение + проявление вместе: штриховка та же, что у целой линии, светлое ядро тоже в точках', () => {
    const dotted = { ...lime, dash: 'dotted' as const }
    const a = make('line', { reveal: 2, glow: true, style: dotted })
    const early = buildOverlaySvg([a], 1000, 500, [], { time: 5 })
    const done = buildOverlaySvg([a], 1000, 500, [], { time: 9 })
    const dash = (svg: string): string => svg.match(/stroke-dasharray="([^"]+)"/)![1]
    expect(dash(early)).toBe(dash(done))
    expect(early.match(/data-part="core"[^>]*stroke-dasharray/)).not.toBeNull()
    expect(early).toContain('data-part="glow"')
  })

  it('кривая: путь обрезается, наконечник — в конце; свечение ложится на оба', () => {
    const a = make('curve', { reveal: 2, glow: true })
    const early = buildOverlaySvg([a], 1000, 500, [], { time: 5 })
    const done = buildOverlaySvg([a], 1000, 500, [], { time: 6 })
    expect(early).not.toContain('data-part="body"')
    expect(done).toContain('data-part="body"')
    expect(early).toContain('data-part="glow"')
    expect(early).toContain('data-part="core"')
  })

  it('«только кадр»: проявления нет, линия целиком', () => {
    const a = make('line', { reveal: 2, timing: { mode: 'frame', start: 4, freezeSeconds: 3 } })
    expect(buildOverlaySvg([a], 1000, 500, [], { time: 4 })).toBe(buildOverlaySvg([a], 1000, 500))
  })

  it('клип, начатый посреди отрезка: доля считается от начала отрезка, а не клипа', () => {
    const a = make('line', { reveal: 2 })
    // Кадр на 5 с: прошла половина проявления, как при перемотке на 5 с.
    expect(lineEnd(buildOverlaySvg([a], 1000, 500, [], { time: 5 }))).toBeCloseTo(500, 0)
  })

  it('phaseKeyOf: ключ зависит от доли проявления, а после проявления не меняется', () => {
    const a = make('arrow', { reveal: 2 })
    expect(phaseKeyOf([a], 4.5)).not.toBe(phaseKeyOf([a], 5))
    expect(phaseKeyOf([a], 6)).toBe(phaseKeyOf([a], 9))
    const plain = make('arrow')
    expect(phaseKeyOf([plain], 4.5)).toBe(phaseKeyOf([plain], 9))
  })
})

describe('проявление: рисунок с ключами и короткие стрелки', () => {
  const t = { mode: 'range' as const, start: 0, duration: 10 }
  const lime = { color: '#c6ff3d', width: 0.01, dash: 'solid' as const }
  const x2 = (svg: string): number =>
    Number(svg.match(/<line[^>]*data-part="line"[^>]*x2="([\d.]+)"/)![1])

  it('рисунок с ключами: доля от длины ТЕКУЩЕЙ геометрии, кэшировать кадр нельзя', () => {
    const moving = {
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b6a01',
      space: 'screen',
      type: 'line',
      p1: { x: 0.1, y: 0.5 },
      p2: { x: 0.3, y: 0.5 },
      style: lime,
      timing: t,
      reveal: 2,
      keyframes: [
        { t: 0, geom: { p1: { x: 0.1, y: 0.5 }, p2: { x: 0.3, y: 0.5 } } },
        { t: 2, geom: { p1: { x: 0.1, y: 0.5 }, p2: { x: 0.9, y: 0.5 } } }
      ]
    } as unknown as Annotation
    expect(phaseKeyOf([moving], 1)).toBeNull()
    const geom = resolveAt(moving, 1) as unknown as { p2: { x: number } }
    // В момент 1 с геометрия — половина пути: p2.x = 0.6, доля проявления 0.5.
    expect(geom.p2.x).toBeCloseTo(0.6)
    const svg = buildOverlaySvg([resolveAt(moving, 1)], 1000, 500, [], { time: 1 })
    expect(x2(svg)).toBeCloseTo(100 + 0.5 * (600 - 100), 0)
  })

  it('короткая стрелка: наконечник появляется ровно тогда, когда стержень дорос', () => {
    const short = {
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b6a02',
      space: 'screen',
      type: 'arrow',
      p1: { x: 0.5, y: 0.5 },
      p2: { x: 0.54, y: 0.5 },
      style: lime,
      timing: t,
      reveal: 2
    } as Annotation
    const at = (s: number): string => buildOverlaySvg([short], 1000, 500, [], { time: s })
    const end = x2(at(2))
    for (const s of [1.5, 1.99, 1.9999]) {
      expect(at(s)).not.toContain('<polygon')
      if (s < 1.9) expect(x2(at(s))).toBeLessThan(end - 1)
    }
    expect(x2(at(1.9999))).toBeCloseTo(end, 1)
    expect(at(2)).toContain('<polygon')
  })
})
