// Новые инструменты: попадание курсора, ручки и перемещение (экран), хранилище свойств, черновик зоны и связей.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  type Annotation,
  type Chain,
  type Curve,
  type Loupe,
  type Pen,
  type ScreenAnnotation,
  type Spotlight,
  type Zone
} from '../../../../shared/annotations'
import { curveMid } from '../../../../shared/tools/curve'
import { paintScreenTool } from '../../../../shared/tools/screenPaint'
import { useAnnotationsStore } from './annotationsStore'
import { bboxOf, handlesOf, moveBy, moveHandle } from './geometry'
import { handleAt, hitAnnotation, topHit } from './hit'
import { spotInputs } from './spotInputs'
import {
  canFinishDraft,
  cancelPolyDraft,
  draftAnnotation,
  finishPolyDraft,
  removeLastDraftPoint,
  usePolyDraft
} from './polyDraft'

const size = { w: 1000, h: 500 }
const measure = (text: string, px: number): number => text.length * px * 0.5
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const base = {
  space: 'screen' as const,
  style: { color: '#ffffff', width: 0.01, dash: 'solid' as const },
  timing: { mode: 'range' as const, start: 0, duration: 3 }
}
const spot: Spotlight = {
  ...base,
  id: uuid(1),
  type: 'spot',
  p1: { x: 0.4, y: 0.2 },
  p2: { x: 0.5, y: 0.6 },
  dim: 0.55
}
const curve: Curve = {
  ...base,
  id: uuid(2),
  type: 'curve',
  p1: { x: 0.1, y: 0.8 },
  p2: { x: 0.5, y: 0.8 },
  c: { x: 0.3, y: 0.4 }
}
const pen: Pen = {
  ...base,
  id: uuid(3),
  type: 'pen',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.1 }
  ],
  arrow: false
}
const zone: Zone = {
  ...base,
  id: uuid(4),
  type: 'zone',
  points: [
    { x: 0.6, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.4 },
    { x: 0.6, y: 0.4 }
  ],
  opacity: 0.3
}
const loupe: Loupe = {
  ...base,
  id: uuid(5),
  type: 'loupe',
  pos: { x: 0.8, y: 0.7 },
  src: { x: 0.3, y: 0.5 },
  radius: 0.1,
  zoom: 2
}
const chain: Chain = {
  ...base,
  id: uuid(6),
  type: 'chain',
  points: [
    { x: 0.1, y: 0.9 },
    { x: 0.3, y: 0.95 },
    { x: 0.5, y: 0.9 }
  ],
  fill: false
}

describe('попадание: новые рисунки на экране', () => {
  it('прожектор: внутри эллипса — попали, далеко снаружи — нет', () => {
    // Эллипс: центр (450, 200) px, полуоси 50 × 100.
    expect(hitAnnotation(spot, { x: 450, y: 200 }, size, measure)).toBe(true)
    expect(hitAnnotation(spot, { x: 450, y: 290 }, size, measure)).toBe(true)
    expect(hitAnnotation(spot, { x: 600, y: 200 }, size, measure)).toBe(false)
    expect(hitAnnotation(spot, { x: 450, y: 330 }, size, measure)).toBe(false)
  })

  it('кривая: попадаем по самой кривой, а не по хорде и не по управляющей точке', () => {
    const onCurve = curveMid({ x: 100, y: 400 }, { x: 300, y: 200 }, { x: 500, y: 400 })
    expect(hitAnnotation(curve, onCurve, size, measure)).toBe(true)
    // Управляющая точка лежит вне кривой.
    expect(hitAnnotation(curve, { x: 300, y: 200 }, size, measure)).toBe(false)
    // Хорда (прямая между концами) тоже вне кривой — в середине.
    expect(hitAnnotation(curve, { x: 300, y: 400 }, size, measure)).toBe(false)
  })

  it('перо: по линии попадаем, рядом нет', () => {
    // Точка на отрезке между (100,50) и (200,100) → (150, 75); линия сглажена, допуск 7 px.
    expect(hitAnnotation(pen, { x: 200, y: 100 }, size, measure)).toBe(true)
    expect(hitAnnotation(pen, { x: 200, y: 160 }, size, measure)).toBe(false)
  })

  it('зона: вся площадь внутри — попадание', () => {
    expect(hitAnnotation(zone, { x: 750, y: 125 }, size, measure)).toBe(true)
    expect(hitAnnotation(zone, { x: 500, y: 125 }, size, measure)).toBe(false)
  })

  it('связь: по звену и по узлу; пустое место между звеньями — нет', () => {
    expect(hitAnnotation(chain, { x: 200, y: 462 }, size, measure)).toBe(true)
    expect(hitAnnotation(chain, { x: 100, y: 450 }, size, measure)).toBe(true)
    expect(hitAnnotation(chain, { x: 300, y: 300 }, size, measure)).toBe(false)
  })

  it('лупа: линза, исходный круг и соединительная линия', () => {
    expect(hitAnnotation(loupe, { x: 800, y: 350 }, size, measure)).toBe(true)
    // Источник (300, 250): радиус r/zoom = 25.
    expect(hitAnnotation(loupe, { x: 300, y: 250 }, size, measure)).toBe(true)
    // Линия между кругами.
    expect(hitAnnotation(loupe, { x: 550, y: 300 }, size, measure)).toBe(true)
    expect(hitAnnotation(loupe, { x: 550, y: 100 }, size, measure)).toBe(false)
  })

  it('верхним считается последний нарисованный рисунок', () => {
    const list: ScreenAnnotation[] = [zone, { ...zone, id: uuid(40) }]
    expect(topHit(list, { x: 750, y: 125 }, size, measure)?.id).toBe(uuid(40))
  })
})

describe('ручки: новые рисунки на экране', () => {
  it('кривая: p1, p2 и c (в середине кривой); handleAt находит ближайшую', () => {
    const paint = paintScreenTool(curve, size)
    expect(paint.handles.map((h) => h.id)).toEqual(['p1', 'p2', 'c'])
    const mid = paint.handles[2].point
    expect(mid.x).toBeCloseTo(300, 6)
    expect(mid.y).toBeCloseTo(0.25 * 400 + 0.5 * 200 + 0.25 * 400, 6)
    expect(handleAt(curve, { x: mid.x + 3, y: mid.y - 2 }, size)).toBe('c')
    expect(handleAt(curve, { x: 101, y: 401 }, size)).toBe('p1')
    expect(handleAt(curve, { x: 700, y: 100 }, size)).toBeNull()
  })

  it('перетаскивание ручки c изгибает кривую так, чтобы она прошла через курсор', () => {
    const moved = moveHandle(curve, 'c', { x: 0.3, y: 0.5 }) as Curve
    const mid = curveMid(moved.p1, moved.c, moved.p2)
    expect(mid.x).toBeCloseTo(0.3, 9)
    expect(mid.y).toBeCloseTo(0.5, 9)
    expect(moved.p1).toEqual(curve.p1)
  })

  it('сильный изгиб: управляющая точка может уйти за кадр (до 1 кадра), кривая остаётся в кадре', () => {
    // Середину тянут к верхнему краю: c = 2·mid − хорда = −0.2 по вертикали.
    const bent = moveHandle(curve, 'c', { x: 0.3, y: 0.3 }) as Curve
    const mid = curveMid(bent.p1, bent.c, bent.p2)
    expect(mid.y).toBeCloseTo(0.3, 9)
    expect(bent.c.y).toBeCloseTo(-0.2, 9)
    expect(AnnotationSchema.safeParse(bent).success).toBe(true)
    // Дальше −1 не уходит.
    const extreme = moveHandle(curve, 'c', { x: 0.3, y: 0 }) as Curve
    expect(extreme.c.y).toBeGreaterThanOrEqual(-1)
    // Рамка считается по кривой: вся она внутри кадра, значит рисунок можно двигать вниз.
    const box = bboxOf(bent, undefined, size)
    expect(box.y0).toBeGreaterThanOrEqual(0)
  })

  it('зона и связь: вершины v0…vN двигаются по одной', () => {
    expect(handleAt(zone, { x: 600, y: 50 }, size)).toBe('v0')
    expect(handleAt(zone, { x: 900, y: 200 }, size)).toBe('v2')
    const moved = moveHandle(zone, 'v2', { x: 0.95, y: 0.5 }) as Zone
    expect(moved.points[2]).toEqual({ x: 0.95, y: 0.5 })
    expect(moved.points[1]).toEqual(zone.points[1])
    // Вершина за краем кадра возвращается внутрь.
    const clamped = moveHandle(chain, 'v1', { x: 1.4, y: -0.3 }) as Chain
    expect(clamped.points[1]).toEqual({ x: 1, y: 0 })
    expect(moveHandle(chain, 'v9', { x: 0.5, y: 0.5 })).toBe(chain)
  })

  it('прожектор двигается за углы рамки, как круг', () => {
    expect(handlesOf(spot).map((h) => h.id)).toEqual(['nw', 'ne', 'se', 'sw'])
    const moved = moveHandle(spot, 'se', { x: 0.6, y: 0.8 }) as Spotlight
    expect(moved.p1).toEqual({ x: 0.4, y: 0.2 })
    expect(moved.p2).toEqual({ x: 0.6, y: 0.8 })
  })

  it('лупа: src двигает источник, lens — только линзу, size — радиус', () => {
    const paint = paintScreenTool(loupe, size)
    expect(paint.handles.map((h) => h.id)).toEqual(['src', 'lens', 'size'])
    expect(handleAt(loupe, { x: 300, y: 250 }, size)).toBe('src')
    const src = moveHandle(loupe, 'src', { x: 0.2, y: 0.3 }) as Loupe
    expect(src.src).toEqual({ x: 0.2, y: 0.3 })
    expect(src.pos).toEqual(loupe.pos)
    const lens = moveHandle(loupe, 'lens', { x: 0.5, y: 0.4 }) as Loupe
    expect(lens.pos.x).toBeCloseTo(0.5, 9)
    expect(lens.pos.y).toBeCloseTo(0.4 + loupe.radius, 9)
    expect(lens.src).toEqual(loupe.src)
    // Радиус: курсор на расстоянии 75 px по горизонтали = 0.15 высоты кадра.
    const bigger = moveHandle(loupe, 'size', { x: 0.8 + 75 / 1000, y: 0.7 }, size) as Loupe
    expect(bigger.radius).toBeCloseTo(0.15, 9)
    const tiny = moveHandle(loupe, 'size', { x: 0.801, y: 0.7 }, size) as Loupe
    expect(tiny.radius).toBe(0.04)
  })
})

describe('перемещение целиком', () => {
  it('сдвиг не выводит рисунок за картинку', () => {
    const box = bboxOf(zone, undefined, size)
    const moved = moveBy(zone, 0.5, 0, box) as Zone
    expect(Math.max(...moved.points.map((p) => p.x))).toBeCloseTo(1, 9)
    const penBox = bboxOf(pen, undefined, size)
    const penMoved = moveBy(pen, -1, -1, penBox) as Pen
    expect(Math.min(...penMoved.points.map((p) => p.x))).toBeCloseTo(0, 9)
    expect(Math.min(...penMoved.points.map((p) => p.y))).toBeCloseTo(0, 9)
  })

  it('лупа: сдвиг двигает линзу и источник вместе; рамка учитывает радиус линзы', () => {
    const box = bboxOf(loupe, undefined, size)
    // Радиус 0.1 высоты = 50 px = 0.05 ширины; линза у (0.8, 0.7).
    expect(box.x1).toBeCloseTo(0.85, 9)
    expect(box.y1).toBeCloseTo(0.8, 9)
    const moved = moveBy(loupe, 0.1, 0, box) as Loupe
    expect(moved.pos.x).toBeCloseTo(0.9, 9)
    expect(moved.src.x).toBeCloseTo(0.4, 9)
    const clipped = moveBy(loupe, 0.5, 0, box) as Loupe
    expect(clipped.pos.x).toBeCloseTo(0.95, 9)
  })

  it('кривая сдвигается вместе с управляющей точкой', () => {
    const moved = moveBy(curve, 0.1, -0.1, bboxOf(curve)) as Curve
    expect(moved.c.x).toBeCloseTo(0.4, 9)
    expect(moved.c.y).toBeCloseTo(0.3, 9)
    expect(moved.p2.x).toBeCloseTo(0.6, 9)
    expect(moved.p2.y).toBeCloseTo(0.7, 9)
  })
})

describe('схема принимает всё, что создают инструменты', () => {
  it('рисунки выше проходят AnnotationSchema', () => {
    for (const a of [spot, curve, pen, zone, loupe, chain]) {
      expect(AnnotationSchema.safeParse(a).success).toBe(true)
    }
  })
})

const s = (): ReturnType<typeof useAnnotationsStore.getState> => useAnnotationsStore.getState()

describe('хранилище: свойства и вершины', () => {
  beforeEach(() => {
    s().reset()
    s().setTool('select')
  })

  it('setProps меняет свойство выбранного рисунка, отмена возвращает; свойства запоминаются для новых', () => {
    s().add(spot)
    s().setProps(spot.id, { dim: 0.7 })
    expect((s().items[0] as Spotlight).dim).toBe(0.7)
    expect(s().options.dim).toBe(0.7)
    s().undo()
    expect((s().items[0] as Spotlight).dim).toBe(0.55)
    s().redo()
    expect((s().items[0] as Spotlight).dim).toBe(0.7)
    s().add(loupe)
    s().setProps(loupe.id, { zoom: 3 })
    expect((s().items[1] as Loupe).zoom).toBe(3)
    expect(s().options.zoom).toBe(3)
    s().add(pen)
    s().setProps(pen.id, { arrow: true })
    expect((s().items[2] as Pen).arrow).toBe(true)
  })

  it('быстрые правки ползунка склеиваются в один шаг отмены', () => {
    s().add(zone)
    const before = s().past.length
    s().setProps(zone.id, { opacity: 0.4 })
    s().setProps(zone.id, { opacity: 0.45 })
    s().setProps(zone.id, { opacity: 0.5 })
    expect(s().past.length).toBe(before + 1)
    s().undo()
    expect((s().items[0] as Zone).opacity).toBe(0.3)
  })

  it('удаление выбранной вершины: отмена возвращает, меньше минимума нельзя', () => {
    s().add(zone)
    s().selectNode(1)
    expect(s().removeSelectedNode()).toBe(true)
    expect((s().items[0] as Zone).points).toHaveLength(3)
    expect(s().selectedNode).toBeNull()
    s().undo()
    expect((s().items[0] as Zone).points).toHaveLength(4)
    // Остаётся три вершины — удалять больше нельзя.
    s().selectNode(0)
    expect(s().removeSelectedNode()).toBe(true)
    s().selectNode(0)
    expect(s().removeSelectedNode()).toBe(false)
    expect((s().items[0] as Zone).points).toHaveLength(3)
  })

  it('у связи минимум две точки', () => {
    s().add(chain)
    s().selectNode(2)
    expect(s().removeSelectedNode()).toBe(true)
    s().selectNode(0)
    expect(s().removeSelectedNode()).toBe(false)
    expect((s().items[0] as Chain).points).toHaveLength(2)
  })

  it('выбор другого рисунка сбрасывает выбранную вершину; без вершины ничего не удаляется', () => {
    s().add(zone)
    s().add(chain)
    s().select(zone.id)
    s().selectNode(2)
    s().select(chain.id)
    expect(s().selectedNode).toBeNull()
    expect(s().removeSelectedNode()).toBe(false)
  })

  it('новое видео сохраняет запомненные свойства', () => {
    s().add(spot)
    s().setProps(spot.id, { dim: 0.3 })
    s().reset()
    expect(s().options.dim).toBe(0.3)
    expect(s().items).toHaveLength(0)
  })
})

describe('черновик зоны и связи', () => {
  beforeEach(() => {
    s().reset()
    s().setTool('zone')
    cancelPolyDraft()
  })

  const begin = (tool: 'zone' | 'chain'): void =>
    usePolyDraft.getState().begin({ tool, space: 'screen', calibrationId: null, start: 1 })
  const add = (x: number, y: number): void => usePolyDraft.getState().addPoint({ x, y })

  it('Enter с двумя точками зону не замыкает; с тремя — создаёт рисунок', () => {
    begin('zone')
    add(0.1, 0.1)
    add(0.5, 0.1)
    expect(canFinishDraft(usePolyDraft.getState().draft!)).toBe(false)
    expect(finishPolyDraft()).toBe(false)
    expect(s().items).toHaveLength(0)
    add(0.3, 0.5)
    expect(finishPolyDraft()).toBe(true)
    expect(usePolyDraft.getState().draft).toBeNull()
    expect(s().items).toHaveLength(1)
    const zone = s().items[0]
    expect(zone.type).toBe('zone')
    expect(zone.type === 'zone' && zone.points).toHaveLength(3)
    expect(AnnotationSchema.safeParse(zone).success).toBe(true)
    expect(s().selectedId).toBe(zone.id)
  })

  it('три точки на одной прямой — не зона', () => {
    begin('zone')
    add(0.1, 0.1)
    add(0.2, 0.2)
    add(0.3, 0.3)
    expect(finishPolyDraft()).toBe(false)
    expect(s().items).toHaveLength(0)
  })

  it('Backspace убирает последнюю вершину, а с последней отменяет черновик', () => {
    begin('chain')
    add(0.1, 0.1)
    add(0.2, 0.2)
    expect(removeLastDraftPoint()).toBe(true)
    expect(usePolyDraft.getState().draft?.points).toHaveLength(1)
    expect(removeLastDraftPoint()).toBe(true)
    expect(usePolyDraft.getState().draft).toBeNull()
    expect(removeLastDraftPoint()).toBe(false)
  })

  it('Esc отменяет черновик и ничего не создаёт; без черновика возвращает false', () => {
    begin('zone')
    add(0.1, 0.1)
    expect(cancelPolyDraft()).toBe(true)
    expect(usePolyDraft.getState().draft).toBeNull()
    expect(s().items).toHaveLength(0)
    expect(cancelPolyDraft()).toBe(false)
  })

  it('связь создаётся от двух разных точек и берёт запомненные свойства', () => {
    s().setTool('chain')
    s().add(spot)
    s().setProps(spot.id, { dim: 0.4 })
    begin('chain')
    add(0.1, 0.5)
    expect(finishPolyDraft()).toBe(false)
    add(0.3, 0.55)
    expect(finishPolyDraft()).toBe(true)
    const made = s().items[s().items.length - 1]
    expect(made.type).toBe('chain')
    expect(AnnotationSchema.safeParse(made).success).toBe(true)
  })

  it('смена инструмента отменяет черновик', () => {
    begin('zone')
    add(0.1, 0.1)
    s().setTool('arrow')
    expect(usePolyDraft.getState().draft).toBeNull()
  })

  it('предпросмотр включает вершину под курсором, итоговый рисунок — нет', () => {
    begin('zone')
    add(0.1, 0.1)
    add(0.5, 0.1)
    usePolyDraft.getState().setHover({ x: 0.3, y: 0.6 })
    const d = usePolyDraft.getState().draft!
    const preview = draftAnnotation(d, true) as Annotation
    const final = draftAnnotation(d, false) as Annotation
    expect(preview.type === 'zone' && preview.points).toHaveLength(3)
    expect(final.type === 'zone' && final.points).toHaveLength(2)
  })

  it('на поле черновик даёт рисунок в метрах с разметкой и «Только кадр»', () => {
    usePolyDraft.getState().begin({
      tool: 'zone',
      space: 'pitch',
      calibrationId: '00000000-0000-4000-8000-0000000000c1',
      start: 1.23
    })
    usePolyDraft.getState().addPoint({ x: 0, y: 13.84 })
    usePolyDraft.getState().addPoint({ x: 16.5, y: 13.84 })
    usePolyDraft.getState().addPoint({ x: 16.5, y: 54.16 })
    const d = usePolyDraft.getState().draft!
    const a = draftAnnotation(d, false)
    expect(a.type).toBe('pzone')
    expect(a.timing.mode).toBe('frame')
    expect('calibrationId' in a && a.calibrationId).toBe('00000000-0000-4000-8000-0000000000c1')
    expect(a.type === 'pzone' && a.showArea).toBe(true)
  })
})

describe('прожекторы: освещённые области из списка рисунков', () => {
  it('берутся только прожекторы; затемнение и контур пятна по рамке эллипса', () => {
    const inputs = spotInputs(
      [spot, zone, curve, { ...spot, id: uuid(41), dim: 0.7 }],
      size,
      () => null
    )
    expect(inputs).toHaveLength(2)
    expect(inputs.map((i) => i.dim)).toEqual([0.55, 0.7])
    const xs = inputs[0].lit[0].map((p) => p.x)
    const ys = inputs[0].lit[0].map((p) => p.y)
    // Рамка: x 0.4–0.5 → 400–500 px, y 0.2–0.6 → 100–300 px.
    expect(Math.min(...xs)).toBeCloseTo(400, 6)
    expect(Math.max(...xs)).toBeCloseTo(500, 6)
    expect(Math.min(...ys)).toBeCloseTo(100, 6)
    expect(Math.max(...ys)).toBeCloseTo(300, 6)
  })

  it('прожектор на поле без разметки в маску не попадает', () => {
    const ground: Annotation = {
      id: uuid(42),
      space: 'pitch',
      calibrationId: uuid(900),
      type: 'pspot',
      center: { x: 9, y: 34 },
      radius: 2,
      dim: 0.5,
      beam: true,
      style: base.style,
      timing: { mode: 'frame', start: 1, freezeSeconds: 3 }
    }
    expect(spotInputs([ground], size, () => null)).toEqual([])
  })
})
