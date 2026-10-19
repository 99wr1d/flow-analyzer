import { beforeEach, describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  type ScreenAnnotation as Annotation
} from '../../../../shared/annotations'
import { useAnnotationsStore } from './annotationsStore'
import { LEVELS } from './styles'

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
