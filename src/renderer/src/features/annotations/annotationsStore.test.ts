import { beforeEach, describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  type ScreenAnnotation as Annotation
} from '../../../../shared/annotations'
import { useAnnotationsStore } from './annotationsStore'
import { DEFAULT_STYLE, LEVELS } from './styles'

const arrow = (n: number): Annotation => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  space: 'screen',
  type: 'arrow',
  p1: { x: 0.1, y: 0.1 },
  p2: { x: 0.6, y: 0.4 },
  style: { color: '#ffffff', width: 0.011, dash: 'solid' },
  timing: { mode: 'range', start: 1, duration: 3 }
})

const s = (): ReturnType<typeof useAnnotationsStore.getState> => useAnnotationsStore.getState()

describe('annotationsStore', () => {
  beforeEach(() => {
    s().reset()
    s().setTool('select')
  })

  it('добавление выбирает рисунок; отмена/повтор сохраняют согласованность выделения', () => {
    s().add(arrow(1))
    expect(s().selectedId).toBe(arrow(1).id)
    s().undo()
    expect(s().items).toHaveLength(0)
    expect(s().selectedId).toBeNull()
    s().redo()
    expect(s().items).toHaveLength(1)
  })

  it('смена стиля применяется к выбранному рисунку и к новым', () => {
    s().add(arrow(1))
    s().setStyle({ color: '#ff3b30', level: 2, dash: 'dashed' })
    const a = s().items[0]
    expect(a.type === 'arrow' && a.style).toEqual({
      color: '#ff3b30',
      width: LEVELS[2].width,
      dash: 'dashed'
    })
    expect(s().style.color).toBe('#ff3b30')
    expect(AnnotationSchema.safeParse(a).success).toBe(true)
    s().undo()
    expect(s().items[0].style.color).toBe('#ffffff')
  })

  it('удаление и сброс при новом видео', () => {
    s().add(arrow(1))
    s().add(arrow(2))
    s().remove(arrow(2).id)
    expect(s().items).toHaveLength(1)
    expect(s().selectedId).toBeNull()
    s().reset()
    expect(s().items).toHaveLength(0)
    expect(s().past).toHaveLength(0)
    expect(s().future).toHaveLength(0)
  })

  it('выбор инструмента рисования снимает выделение', () => {
    s().add(arrow(1))
    s().setTool('arrow')
    expect(s().selectedId).toBeNull()
  })
})

describe('«Под игроками» для новых рисунков', () => {
  const ring = (n: number): Annotation =>
    ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      space: 'pitch',
      calibrationId: '00000000-0000-4000-8000-0000000000c1',
      type: 'ring',
      center: { x: 5, y: 5 },
      radius: 1,
      style: { color: '#ffffff', width: 0.011, dash: 'solid' },
      timing: { mode: 'frame', start: 1, freezeSeconds: 3 }
    }) as unknown as Annotation
  const text = (n: number): Annotation =>
    ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      space: 'screen',
      type: 'text',
      pos: { x: 0.1, y: 0.1 },
      text: 'Пас',
      style: { color: '#ffffff', size: 0.05, background: true },
      timing: { mode: 'range', start: 1, duration: 3 }
    }) as unknown as Annotation

  beforeEach(() => {
    s().reset()
    s().setUnderNew('pitch', true)
    s().setUnderNew('screen', false)
  })

  it('по умолчанию: на поле — под игроками, на экране — поверх; подписи без флага', () => {
    s().add(ring(1))
    s().add(arrow(2))
    s().add(text(3))
    const [r, a, t] = s().items as Array<Annotation & { underPlayers?: boolean }>
    expect(r.underPlayers).toBe(true)
    expect(a.underPlayers).toBe(false)
    expect('underPlayers' in t).toBe(false)
  })

  it('выбор для места запоминается и применяется к следующим рисункам', () => {
    s().setUnderNew('screen', true)
    s().add(arrow(1))
    s().setUnderNew('pitch', false)
    s().add(ring(2))
    const [a, r] = s().items as Array<Annotation & { underPlayers?: boolean }>
    expect(a.underPlayers).toBe(true)
    expect(r.underPlayers).toBe(false)
  })

  it('новый столб (прожектор формы «столб») — под игроками, пока для экрана не выбрано иное; овал — без флага', () => {
    useAnnotationsStore.setState({ underNew: { pitch: null, screen: null } })
    const spot = (n: number, form: 'pillar' | 'oval'): Annotation =>
      ({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        space: 'screen',
        type: 'spot',
        form,
        p1: { x: 0.4, y: 0.6 },
        p2: { x: 0.5, y: 0.65 },
        dim: 0,
        style: { color: '#ffffff', width: 0.01, dash: 'solid' },
        timing: { mode: 'range', start: 1, duration: 3 }
      }) as unknown as Annotation
    s().add(spot(1, 'pillar'))
    s().add(spot(2, 'oval'))
    const [p, o] = s().items as Array<Annotation & { underPlayers?: boolean }>
    expect(p.underPlayers).toBe(true)
    expect('underPlayers' in o).toBe(false)
  })

  it('явно заданный флаг у добавляемого рисунка не перезаписывается', () => {
    s().add({ ...arrow(1), underPlayers: true } as Annotation)
    expect((s().items[0] as Annotation & { underPlayers?: boolean }).underPlayers).toBe(true)
  })

  it('переключатель у выбранного рисунка меняет его и запоминается для его места; отмена возвращает', () => {
    s().add(ring(1))
    s().setProps(ring(1).id, { underPlayers: false })
    expect((s().items[0] as Annotation & { underPlayers?: boolean }).underPlayers).toBe(false)
    expect(s().underNew.pitch).toBe(false)
    expect(s().underNew.screen).toBe(false)
    s().undo()
    expect((s().items[0] as Annotation & { underPlayers?: boolean }).underPlayers).toBe(true)
  })

  it('запомненный выбор переживает смену видео и загрузку проекта', () => {
    s().setUnderNew('screen', true)
    s().reset()
    expect(s().underNew.screen).toBe(true)
    s().load([])
    expect(s().underNew.screen).toBe(true)
  })
})

describe('анимация в хранилище', () => {
  beforeEach(() => {
    s().reset()
    s().setTool('select')
  })

  it('«Анимировать»: ключ в кадре момента, отмена убирает, повтор возвращает', () => {
    s().add(arrow(1))
    s().startAnimation(arrow(1).id, 1.0, 25, 60)
    const a = s().items[0] as unknown as { keyframes: Array<{ t: number }> }
    expect(a.keyframes).toHaveLength(1)
    expect(a.keyframes[0].t).toBeCloseTo(1.02, 6)
    s().undo()
    expect((s().items[0] as unknown as { keyframes?: unknown }).keyframes).toBeUndefined()
    s().redo()
    expect((s().items[0] as unknown as { keyframes: unknown[] }).keyframes).toHaveLength(1)
  })

  it('перетаскивание (preview + commitFrom) создаёт автоключ одним шагом отмены', async () => {
    const { applyGeomEdit } = await import('../../../../shared/animation')
    s().add(arrow(1))
    s().startAnimation(arrow(1).id, 1.0, 25, 60)
    const before = s().items
    const stored = before[0]
    const moved = { ...stored, p1: { x: 0.5, y: 0.5 } } as typeof stored
    s().preview([applyGeomEdit(stored, moved, 2.0, 25)])
    s().preview([
      applyGeomEdit(stored, { ...stored, p1: { x: 0.6, y: 0.5 } } as typeof stored, 2.0, 25)
    ])
    s().commitFrom(before)
    const keys = (s().items[0] as unknown as { keyframes: Array<{ geom: { p1: { x: number } } }> })
      .keyframes
    expect(keys).toHaveLength(2)
    expect(keys[1].geom.p1.x).toBe(0.6)
    s().undo()
    expect((s().items[0] as unknown as { keyframes: unknown[] }).keyframes).toHaveLength(1)
  })

  it('«Ключ здесь», удаление и «Убрать анимацию»', () => {
    s().add(arrow(1))
    s().startAnimation(arrow(1).id, 1.0, 25, 60)
    s().addKey(arrow(1).id, 2.0, 25)
    const keys = (): unknown[] =>
      (s().items[0] as unknown as { keyframes?: unknown[] }).keyframes ?? []
    expect(keys()).toHaveLength(2)
    s().removeKey(arrow(1).id, 1)
    expect(keys()).toHaveLength(1)
    s().stopAnimation(arrow(1).id, 1.0)
    expect(keys()).toHaveLength(0)
  })

  it('сдвиг ключа ромбиком без истории, потом один шаг отмены; выбранный ключ сбрасывается при смене рисунка', () => {
    s().add(arrow(1))
    s().startAnimation(arrow(1).id, 1.0, 25, 60)
    s().addKey(arrow(1).id, 2.0, 25)
    const before = s().items
    s().selectKey(1)
    s().previewRetime(before, arrow(1).id, 1, 2.5, 25)
    s().previewRetime(before, arrow(1).id, 1, 2.9, 25)
    s().commitFrom(before)
    const t = (s().items[0] as unknown as { keyframes: Array<{ t: number }> }).keyframes[1].t
    expect(t).toBeCloseTo(2.9, 1)
    s().undo()
    expect(
      (s().items[0] as unknown as { keyframes: Array<{ t: number }> }).keyframes[1].t
    ).toBeCloseTo(2.02, 6)
    s().select(null)
    expect(s().selectedKey).toBeNull()
  })

  it('удаление вершины зоны уходит во все ключи', async () => {
    const { startAnimation, applyGeomEdit } = await import('../../../../shared/animation')
    const zone = {
      id: arrow(7).id,
      space: 'screen' as const,
      type: 'zone' as const,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.1, y: 0.5 }
      ],
      opacity: 0.3,
      style: { color: '#ffffff', width: 0.011, dash: 'solid' as const },
      timing: { mode: 'range' as const, start: 1, duration: 3 }
    }
    const a0 = startAnimation(zone, 1.0, 25, 60)
    const a1 = applyGeomEdit(
      a0,
      { ...a0, points: a0.points.map((p) => ({ x: p.x + 0.2, y: p.y })) },
      2.0,
      25
    )
    s().load([a1])
    s().select(zone.id)
    s().selectNode(1)
    expect(s().removeSelectedNode()).toBe(true)
    const z = s().items[0] as unknown as {
      points: unknown[]
      keyframes: Array<{ geom: { points: unknown[] } }>
    }
    expect(z.points).toHaveLength(3)
    for (const k of z.keyframes) expect(k.geom.points).toHaveLength(3)
    expect(AnnotationSchema.safeParse(s().items[0]).success).toBe(true)
  })
})

describe('0.16.4: подсветки по умолчанию под игроками', () => {
  const base = {
    style: { color: '#ffffff', width: 0.011, dash: 'solid' },
    timing: { mode: 'range', start: 1, duration: 3 }
  }
  const at = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const circle = (n: number): Annotation =>
    ({
      id: at(n),
      space: 'screen',
      type: 'circle',
      p1: { x: 0.1, y: 0.1 },
      p2: { x: 0.2, y: 0.3 },
      ...base
    }) as unknown as Annotation
  const zone = (n: number): Annotation =>
    ({
      id: at(n),
      space: 'screen',
      type: 'zone',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.1 },
        { x: 0.4, y: 0.4 }
      ],
      opacity: 0.3,
      ...base
    }) as unknown as Annotation
  const ring = (n: number): Annotation =>
    ({
      id: at(n),
      space: 'pitch',
      calibrationId: at(900),
      type: 'ring',
      center: { x: 5, y: 5 },
      radius: 1,
      ...base
    }) as unknown as Annotation
  const flag = (i: number): boolean | undefined =>
    (s().items[i] as Annotation & { underPlayers?: boolean }).underPlayers

  beforeEach(() => {
    s().reset()
    useAnnotationsStore.setState({ underNew: { pitch: null, screen: null } })
  })

  it('кольцо, круг и зона кладутся под игроков, стрелка на экране — поверх', () => {
    s().add(ring(1))
    s().add(circle(2))
    s().add(zone(3))
    s().add(arrow(4))
    expect([flag(0), flag(1), flag(2), flag(3)]).toEqual([true, true, true, false])
  })

  it('выбор пользователя сильнее умолчания: выключил для круга — следующая зона тоже поверх', () => {
    s().add(circle(1))
    s().setProps(at(1), { underPlayers: false })
    s().add(zone(2))
    expect(flag(1)).toBe(false)
  })

  it('рисунок со своим флагом не перезаписывается', () => {
    s().add({ ...circle(1), underPlayers: false } as Annotation)
    expect(flag(0)).toBe(false)
  })

  it('заливка нового круга и кольца запоминается как свойство', () => {
    s().add(circle(1))
    s().setProps(at(1), { fillOpacity: 0.3 })
    expect(s().options.fillOpacity).toBe(0.3)
    expect((s().items[0] as { fillOpacity?: number }).fillOpacity).toBe(0.3)
  })
})

describe('правка стиля старого рисунка (0.18)', () => {
  const label = (): Annotation => ({
    id: '00000000-0000-4000-8000-0000000000a1',
    space: 'screen',
    type: 'text',
    pos: { x: 0.1, y: 0.1 },
    text: 'Пас',
    style: { color: '#ffffff', size: 0.045, background: true },
    timing: { mode: 'range', start: 1, duration: 3 }
  })
  beforeEach(() => {
    s().reset()
    s().setTool('select')
  })

  it('смена цвета старой подписи не добавляет ей тень и не убирает плашку', () => {
    s().add(label())
    s().setStyle({ color: '#c6ff3d' })
    const a = s().items[0]
    expect(a.type === 'text' && a.style).toEqual({
      color: '#c6ff3d',
      size: 0.045,
      background: true
    })
  })

  it('переключатель «тень» меняет только тень', () => {
    s().add(label())
    s().setStyle({ textShadow: true })
    const a = s().items[0]
    expect(a.type === 'text' && a.style).toEqual({
      color: '#ffffff',
      size: 0.045,
      background: true,
      shadow: true
    })
  })

  it('цвет подписи запоминается отдельно: выбор для подписи не красит остальные рисунки, и наоборот', () => {
    s().reset()
    useAnnotationsStore.setState({ style: { ...DEFAULT_STYLE } })
    expect(s().style.textColor).toBe('#c6ff3d')
    expect(s().style.color).toBe('#ffd60a')
    // Инструмент «Подпись»: выбор цвета меняет цвет подписей.
    s().setTool('text')
    s().setStyle({ color: '#ffffff' })
    expect(s().style).toMatchObject({ textColor: '#ffffff', color: '#ffd60a' })
    // Инструмент «Стрелка»: цвет стрелок, подписи не трогает.
    s().setTool('arrow')
    s().setStyle({ color: '#ff3b30' })
    expect(s().style).toMatchObject({ textColor: '#ffffff', color: '#ff3b30' })
    // Выбранная подпись: её цвет меняется, запоминается как цвет подписей.
    s().setTool('select')
    s().add(label())
    s().setStyle({ color: '#4cc9f0' })
    expect(s().style).toMatchObject({ textColor: '#4cc9f0', color: '#ff3b30' })
    useAnnotationsStore.setState({ style: { ...DEFAULT_STYLE } })
  })

  it('смена цвета старой стрелки не добавляет новых полей', () => {
    s().add(arrow(1))
    s().setStyle({ color: '#2e8bff' })
    const a = s().items[0] as unknown as Record<string, unknown>
    for (const k of ['glow', 'reveal', 'look', 'pulse', 'form']) expect(k in a).toBe(false)
  })
})

describe('толщина кольца запоминается отдельно', () => {
  it('с инструментом «Круг» выбор толщины меняет ringLevel, а не толщину остальных рисунков', () => {
    useAnnotationsStore.setState({ tool: 'circle', selectedId: null })
    const before = useAnnotationsStore.getState().style.level
    useAnnotationsStore.getState().setStyle({ level: 2 })
    const st = useAnnotationsStore.getState().style
    expect(st.ringLevel).toBe(2)
    expect(st.level).toBe(before)
    useAnnotationsStore.getState().setStyle({ ringLevel: 0 })
  })
})
