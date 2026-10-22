// Схемы рисунков этапа 15: значения по умолчанию, границы, обратная совместимость со старыми файлами проекта.
import { describe, expect, it } from 'vitest'
import {
  AnnotationListSchema,
  AnnotationSchema,
  DEFAULT_DIM,
  DEFAULT_LOUPE_ZOOM,
  DEFAULT_ZONE_OPACITY,
  MAX_CHAIN_NODES,
  MAX_PEN_POINTS,
  isPitchAnnotation,
  isSpotlight
} from './annotations'
import { ExportRequestSchema } from './export'
import { ProjectSchema, parseProjectText } from './project'
import { sampleProject, uuid } from './project.testkit'

const style = { color: '#ffd60a', width: 0.011, dash: 'solid' }
const range = { mode: 'range', start: 1, duration: 3 }
const frame = { mode: 'frame', start: 1 }
const pt = (x: number, y: number): { x: number; y: number } => ({ x, y })
const cal = uuid(900)

const screen = {
  spot: { id: uuid(1), type: 'spot', p1: pt(0.2, 0.3), p2: pt(0.3, 0.6), style, timing: range },
  curve: {
    id: uuid(2),
    type: 'curve',
    p1: pt(0.1, 0.1),
    p2: pt(0.5, 0.2),
    c: pt(0.3, 0.4),
    style,
    timing: range
  },
  pen: { id: uuid(3), type: 'pen', points: [pt(0.1, 0.1), pt(0.2, 0.3)], style, timing: range },
  zone: {
    id: uuid(4),
    type: 'zone',
    points: [pt(0.1, 0.1), pt(0.5, 0.1), pt(0.3, 0.5)],
    style,
    timing: range
  },
  loupe: {
    id: uuid(5),
    type: 'loupe',
    pos: pt(0.3, 0.3),
    src: pt(0.6, 0.6),
    radius: 0.12,
    style,
    timing: range
  },
  chain: {
    id: uuid(6),
    type: 'chain',
    points: [pt(0.1, 0.5), pt(0.3, 0.55)],
    style,
    timing: range
  }
}
const pitch = {
  pspot: {
    id: uuid(11),
    type: 'pspot',
    space: 'pitch',
    calibrationId: cal,
    center: pt(9, 34),
    radius: 2,
    style,
    timing: frame
  },
  pcurve: {
    id: uuid(12),
    type: 'pcurve',
    space: 'pitch',
    calibrationId: cal,
    p1: pt(1, 2),
    p2: pt(8, 9),
    c: pt(7, 2),
    style,
    timing: frame
  },
  ppen: {
    id: uuid(13),
    type: 'ppen',
    space: 'pitch',
    calibrationId: cal,
    points: [pt(1, 2), pt(3, 4)],
    style,
    timing: frame
  },
  pzone: {
    id: uuid(14),
    type: 'pzone',
    space: 'pitch',
    calibrationId: cal,
    points: [pt(0, 0), pt(10, 0), pt(10, 10)],
    style,
    timing: frame
  },
  pchain: {
    id: uuid(15),
    type: 'pchain',
    space: 'pitch',
    calibrationId: cal,
    points: [pt(0, 0), pt(10, 0)],
    style,
    timing: frame
  }
}

describe('новые рисунки: значения по умолчанию', () => {
  it('рисунки на экране читаются без поля space и получают значения по умолчанию', () => {
    for (const a of Object.values(screen)) {
      const parsed = AnnotationSchema.parse(a)
      expect(parsed.space).toBe('screen')
    }
    const spot = AnnotationSchema.parse(screen.spot)
    expect(spot.type === 'spot' && spot.dim).toBe(DEFAULT_DIM)
    const loupe = AnnotationSchema.parse(screen.loupe)
    expect(loupe.type === 'loupe' && loupe.zoom).toBe(DEFAULT_LOUPE_ZOOM)
    const zone = AnnotationSchema.parse(screen.zone)
    expect(zone.type === 'zone' && zone.opacity).toBe(DEFAULT_ZONE_OPACITY)
    const pen = AnnotationSchema.parse(screen.pen)
    expect(pen.type === 'pen' && pen.arrow).toBe(false)
    const chain = AnnotationSchema.parse(screen.chain)
    expect(chain.type === 'chain' && chain.fill).toBe(false)
  })

  it('рисунки на поле несут calibrationId и метры, значения по умолчанию подставляются', () => {
    for (const a of Object.values(pitch)) {
      const parsed = AnnotationSchema.parse(a)
      expect(isPitchAnnotation(parsed)).toBe(true)
      expect('calibrationId' in parsed && parsed.calibrationId).toBe(cal)
    }
    const spot = AnnotationSchema.parse(pitch.pspot)
    expect(spot.type === 'pspot' && spot.beam).toBe(true)
    expect(spot.type === 'pspot' && spot.dim).toBe(DEFAULT_DIM)
    expect(isSpotlight(spot)).toBe(true)
    const zone = AnnotationSchema.parse(pitch.pzone)
    expect(zone.type === 'pzone' && zone.showArea).toBe(true)
    const chain = AnnotationSchema.parse(pitch.pchain)
    expect(chain.type === 'pchain' && chain.labels).toBe(true)
    // «Только кадр» без freezeSeconds получает стандартные 3 секунды, как у прежних рисунков.
    expect(spot.timing.mode === 'frame' && spot.timing.freezeSeconds).toBe(3)
  })

  it('рисунок на поле без разметки отклоняется', () => {
    const { calibrationId: _unused, ...broken } = pitch.pspot
    void _unused
    expect(AnnotationSchema.safeParse(broken).success).toBe(false)
  })
})

describe('новые рисунки: границы значений', () => {
  it('затемнение 20–80 %, прозрачность 10–60 %, увеличение 1.5, 2 или 3', () => {
    expect(AnnotationSchema.safeParse({ ...screen.spot, dim: 0.19 }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screen.spot, dim: 0.81 }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screen.spot, dim: 0.2 }).success).toBe(true)
    expect(AnnotationSchema.safeParse({ ...screen.spot, dim: 0.8 }).success).toBe(true)
    expect(AnnotationSchema.safeParse({ ...screen.zone, opacity: 0.09 }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screen.zone, opacity: 0.61 }).success).toBe(false)
    for (const zoom of [1.5, 2, 3]) {
      expect(AnnotationSchema.safeParse({ ...screen.loupe, zoom }).success).toBe(true)
    }
    expect(AnnotationSchema.safeParse({ ...screen.loupe, zoom: 2.5 }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screen.loupe, radius: 0.5 }).success).toBe(false)
  })

  it('число точек: перо ≥ 2 и ≤ 400, зона ≥ 3, связь ≥ 2 и ≤ 30', () => {
    expect(AnnotationSchema.safeParse({ ...screen.pen, points: [pt(0, 0)] }).success).toBe(false)
    const many = Array.from({ length: MAX_PEN_POINTS + 1 }, (_, i) => pt(i / 1000, 0.5))
    expect(AnnotationSchema.safeParse({ ...screen.pen, points: many }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screen.pen, points: many.slice(0, 400) }).success).toBe(
      true
    )
    expect(
      AnnotationSchema.safeParse({ ...screen.zone, points: [pt(0, 0), pt(1, 1)] }).success
    ).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screen.chain, points: [pt(0, 0)] }).success).toBe(false)
    const long = Array.from({ length: MAX_CHAIN_NODES + 1 }, (_, i) => pt(i / 100, 0.5))
    expect(AnnotationSchema.safeParse({ ...screen.chain, points: long }).success).toBe(false)
  })

  it('точки вне кадра на экране и вне разумных метров на поле отклоняются', () => {
    // Концы кривой — в кадре; управляющая точка может уйти за кадр, но не дальше одного кадра.
    expect(AnnotationSchema.safeParse({ ...screen.curve, p2: pt(1.5, 0.5) }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...screen.curve, c: pt(1.5, -0.4) }).success).toBe(true)
    expect(AnnotationSchema.safeParse({ ...screen.curve, c: pt(2.5, 0.5) }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...pitch.pspot, center: pt(900, 0) }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...pitch.pspot, radius: 0.1 }).success).toBe(false)
    expect(AnnotationSchema.safeParse({ ...pitch.pspot, radius: 16 }).success).toBe(false)
  })
})

describe('старые проекты читаются, новые сохраняются без потерь', () => {
  it('проект без новых рисунков проходит схему как раньше', () => {
    const project = sampleProject()
    expect(ProjectSchema.safeParse(project).success).toBe(true)
  })

  it('проект со всеми новыми рисунками: сохранение → чтение даёт те же данные', () => {
    const annotations = AnnotationListSchema.parse([
      ...Object.values(screen),
      ...Object.values(pitch)
    ])
    const project = {
      ...sampleProject(),
      annotations,
      calibrations: []
    }
    const json = JSON.stringify(project)
    const parsed = parseProjectText(json)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.project.annotations).toHaveLength(11)
      expect(parsed.project.annotations).toEqual(annotations)
    }
  })

  it('экспорт: запрос прежнего вида (без лупы) принимается, лупа проверяется', () => {
    const request = {
      videoId: 'v1',
      clips: [{ start: 1, end: 3, label: 'Гол' }],
      mode: 'files',
      precision: 'precise',
      padding: 0,
      projectName: null,
      drawings: {
        token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
        fps: 25,
        timings: [{ mode: 'range', start: 1, duration: 1 }]
      }
    }
    const old = ExportRequestSchema.safeParse(request)
    expect(old.success).toBe(true)
    expect(old.success && old.data.drawings?.loupes).toEqual([])
    const withLoupe = ExportRequestSchema.safeParse({
      ...request,
      drawings: {
        ...request.drawings,
        loupes: [{ index: 0, pos: pt(0.3, 0.3), src: pt(0.5, 0.5), radius: 0.12, zoom: 2 }]
      }
    })
    expect(withLoupe.success).toBe(true)
    const bad = ExportRequestSchema.safeParse({
      ...request,
      drawings: {
        ...request.drawings,
        loupes: [{ index: 0, pos: pt(0.3, 0.3), src: pt(0.5, 0.5), radius: 0.12, zoom: 5 }]
      }
    })
    expect(bad.success).toBe(false)
  })
})

describe('прожектор: поле dimmed', () => {
  it('spotDim: нет поля или true — затемняет с силой dim, false — не затемняет', async () => {
    const { spotDim } = await import('./annotations')
    expect(spotDim({ dim: 0.5 })).toBe(0.5)
    expect(spotDim({ dim: 0.5, dimmed: true })).toBe(0.5)
    expect(spotDim({ dim: 0.5, dimmed: false })).toBe(0)
  })
  it('схема принимает dimmed и сохраняет, старый прожектор остаётся без поля', async () => {
    const { SpotlightSchema } = await import('./annotations')
    const base = {
      id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
      type: 'spot',
      p1: { x: 0.1, y: 0.1 },
      p2: { x: 0.2, y: 0.3 },
      dim: 0.5,
      style: { color: '#ffd60a', width: 0.01, dash: 'solid' },
      timing: { mode: 'range', start: 0, duration: 3 }
    }
    expect(SpotlightSchema.parse({ ...base, dimmed: false }).dimmed).toBe(false)
    expect('dimmed' in SpotlightSchema.parse(base)).toBe(false)
  })
})
