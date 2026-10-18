import { beforeEach, describe, expect, it } from 'vitest'
import { EpisodeListSchema, type Episode } from '../../../../shared/episodes'
import { defaultSettings } from '../../../../shared/settings'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { installUnifiedHistory, redoAny, resetWork, undoAny } from '../history/unified'
import { useSettingsStore } from '../settings/settingsStore'
import { useEpisodesStore, sortEpisodes } from './episodesStore'
import { useFeedbackStore } from './feedbackStore'
import { assignEpisodeLanes } from './lanes'
import { applyTag, markIn, markOut, rateCurrent } from './tagging'

const ep = (n: number, start: number, end: number): Episode => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  tagId: 'attack',
  tagName: 'Атака',
  tagColor: '#2bd67b',
  start,
  end,
  rating: null,
  review: false
})

const E = (): ReturnType<typeof useEpisodesStore.getState> => useEpisodesStore.getState()
const A = (): ReturnType<typeof useAnnotationsStore.getState> => useAnnotationsStore.getState()
const P = (): ReturnType<typeof usePlayerStore.getState> => usePlayerStore.getState()

function loadVideo(duration: number, time = 0): void {
  P().loadSource({ id: 'v', fileName: 'v.mp4', sizeBytes: 1, url: 'flow-media://v' })
  P().setMetadata(duration)
  P().setCurrentTime(time)
}

const arrow = (n: number) =>
  ({
    id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: 'arrow',
    p1: { x: 0.1, y: 0.1 },
    p2: { x: 0.6, y: 0.4 },
    style: { color: '#ffffff', width: 0.011, dash: 'solid' },
    timing: { mode: 'range', start: 1, duration: 3 }
  }) as const

beforeEach(() => {
  installUnifiedHistory()
  resetWork()
  usePlayerStore.setState({
    source: null,
    status: 'empty',
    duration: 0,
    currentTime: 0,
    playing: false
  })
  useSettingsStore.setState({ settings: defaultSettings() })
  useFeedbackStore.setState({ toast: null, flash: null })
})

describe('хранилище эпизодов', () => {
  it('добавление не выбирает эпизод; удаление и отмена', () => {
    E().add(ep(1, 1, 3))
    expect(E().items).toHaveLength(1)
    expect(E().selectedId).toBeNull()
    E().select(ep(1, 0, 0).id)
    E().remove(ep(1, 0, 0).id)
    expect(E().items).toHaveLength(0)
    expect(E().selectedId).toBeNull()
    E().undo()
    expect(E().items).toHaveLength(1)
  })

  it('правка границ и заметки; пустая заметка убирает поле; заметки склеиваются в один шаг', () => {
    E().add(ep(1, 1, 3))
    const id = ep(1, 0, 0).id
    E().setRange(id, { start: 0.5, end: 2 })
    expect(E().items[0]).toMatchObject({ start: 0.5, end: 2 })
    E().setNote(id, 'п')
    E().setNote(id, 'пас')
    expect(E().items[0].note).toBe('пас')
    expect(E().past).toHaveLength(3) // добавление, границы, заметка (две правки склеены)
    E().setNote(id, '')
    expect('note' in E().items[0]).toBe(false)
    expect(EpisodeListSchema.safeParse(E().items).success).toBe(true)
  })

  it('сортировка по началу', () => {
    const sorted = sortEpisodes([ep(1, 5, 6), ep(2, 1, 9), ep(3, 1, 2)])
    expect(sorted.map((e) => e.id.slice(-1))).toEqual(['3', '2', '1'])
  })

  it('фильтр по тегам', () => {
    E().toggleFilter('attack')
    E().toggleFilter('goal')
    expect(E().filter).toEqual(['attack', 'goal'])
    E().toggleFilter('attack')
    expect(E().filter).toEqual(['goal'])
    E().clearFilter()
    expect(E().filter).toEqual([])
  })

  it('reset очищает всё', () => {
    E().add(ep(1, 1, 3))
    E().setIn(1)
    E().toggleFilter('attack')
    E().reset()
    expect(E().items).toEqual([])
    expect(E().inPoint).toBeNull()
    expect(E().filter).toEqual([])
    expect(E().past).toEqual([])
  })
})

describe('быстрый тег', () => {
  it('в середине видео: [t − 5, t + 5], воспроизведение не останавливается', () => {
    loadVideo(60, 30)
    P().setPlaying(true)
    applyTag('attack')
    expect(E().items).toHaveLength(1)
    expect(E().items[0]).toMatchObject({
      tagId: 'attack',
      tagName: 'Атака',
      tagColor: '#2bd67b',
      start: 25,
      end: 35
    })
    expect(P().playing).toBe(true)
  })

  it('у начала и у конца видео границы обрезаются', () => {
    loadVideo(4, 2)
    applyTag('attack')
    expect(E().items[0]).toMatchObject({ start: 0, end: 4 })
    resetWork()
    loadVideo(120, 1)
    applyTag('goal')
    expect(E().items[0]).toMatchObject({ tagId: 'goal', start: 0, end: 6 })
    resetWork()
    P().setCurrentTime(119)
    applyTag('goal')
    expect(E().items[0]).toMatchObject({ start: 114, end: 120 })
  })

  it('имя и цвет тега копируются в эпизод, смена тега потом эпизод не меняет', () => {
    loadVideo(60, 30)
    applyTag('shot')
    const settings = defaultSettings()
    settings.tags = settings.tags.map((t) =>
      t.id === 'shot' ? { ...t, name: 'Удар по воротам', color: '#000000' } : t
    )
    useSettingsStore.setState({ settings })
    expect(E().items[0]).toMatchObject({ tagName: 'Удар', tagColor: '#ff8a3d' })
  })

  it('показывает подтверждение и вспышку; неизвестный тег и видео без загрузки игнорируются', () => {
    applyTag('attack') // видео нет
    expect(E().items).toHaveLength(0)
    loadVideo(60, 12.3)
    applyTag('nope')
    expect(E().items).toHaveLength(0)
    applyTag('attack')
    expect(useFeedbackStore.getState().toast?.text).toBe('Эпизод «Атака» 00:07.3–00:17.3')
    expect(useFeedbackStore.getState().flash?.tagId).toBe('attack')
  })

  it('произвольные секунды тега', () => {
    loadVideo(60, 30)
    const settings = defaultSettings()
    settings.tags = [{ id: 'x', name: 'X', color: '#112233', preSeconds: 1, postSeconds: 0.5 }]
    useSettingsStore.setState({ settings })
    applyTag('x')
    expect(E().items[0]).toMatchObject({ start: 29, end: 30.5 })
  })
})

describe('точная разметка Начало/Конец', () => {
  it('обе метки: эпизод ровно по ним, метки сбрасываются', () => {
    loadVideo(4, 1)
    markIn()
    P().setCurrentTime(2.5)
    markOut()
    expect(E().inPoint).toBe(1)
    expect(E().outPoint).toBe(2.5)
    applyTag('shot')
    expect(E().items).toHaveLength(1)
    expect(E().items[0]).toMatchObject({ tagId: 'shot', start: 1, end: 2.5 })
    expect(E().inPoint).toBeNull()
    expect(E().outPoint).toBeNull()
  })

  it('Конец раньше Начала: эпизод не создаётся, метки остаются, показан совет', () => {
    loadVideo(4, 3)
    markIn()
    P().setCurrentTime(1)
    markOut()
    applyTag('attack')
    expect(E().items).toHaveLength(0)
    expect(E().inPoint).toBe(3)
    expect(E().outPoint).toBe(1)
    expect(useFeedbackStore.getState().toast?.kind).toBe('warn')
  })

  it('слишком короткий отрезок между метками: не создаётся', () => {
    loadVideo(4, 1)
    markIn()
    P().setCurrentTime(1.1)
    markOut()
    applyTag('attack')
    expect(E().items).toHaveLength(0)
    expect(useFeedbackStore.getState().toast?.kind).toBe('warn')
  })

  it('одна метка не мешает быстрому тегу и остаётся', () => {
    loadVideo(60, 30)
    markIn()
    applyTag('attack')
    expect(E().items[0]).toMatchObject({ start: 25, end: 35 })
    expect(E().inPoint).toBe(30)
  })

  it('метки можно сбросить; без видео они не ставятся', () => {
    markIn()
    expect(E().inPoint).toBeNull()
    loadVideo(10, 2)
    markIn()
    markOut()
    E().clearMarks()
    expect(E().inPoint).toBeNull()
    expect(E().outPoint).toBeNull()
  })
})

describe('дорожки эпизодов', () => {
  it('непересекающиеся — на одной строке, пересекающиеся — на разных', () => {
    const lanes = assignEpisodeLanes([ep(1, 0, 2), ep(2, 3, 4), ep(3, 1, 3.5)])
    const byId = Object.fromEntries(lanes.map((l) => [l.id.slice(-1), l.lane]))
    expect(byId['1']).toBe(0)
    expect(byId['3']).toBe(1)
    expect(byId['2']).toBe(0) // освободилась после конца первого (3 ≥ 2), а третий кончается позже
  })

  it('касание границ не считается пересечением', () => {
    const lanes = assignEpisodeLanes([ep(1, 0, 2), ep(2, 2, 4)])
    expect(lanes.map((l) => l.lane)).toEqual([0, 0])
  })

  it('не больше четырёх строк, лишние — на последней', () => {
    const many = Array.from({ length: 7 }, (_, i) => ep(i + 1, 0, 10))
    const lanes = assignEpisodeLanes(many)
    expect(Math.max(...lanes.map((l) => l.lane))).toBe(3)
  })

  it('пустой список', () => {
    expect(assignEpisodeLanes([])).toEqual([])
  })
})

describe('общая отмена рисунков и эпизодов', () => {
  it('Ctrl+Z отменяет последнее действие любого вида, по порядку', () => {
    A().add(arrow(1)) // 1
    E().add(ep(1, 1, 3)) // 2
    A().add(arrow(2)) // 3
    E().add(ep(2, 2, 4)) // 4
    expect(A().items).toHaveLength(2)
    expect(E().items).toHaveLength(2)

    undoAny() // отменяет эпизод 2
    expect([A().items.length, E().items.length]).toEqual([2, 1])
    undoAny() // рисунок 2
    expect([A().items.length, E().items.length]).toEqual([1, 1])
    undoAny() // эпизод 1
    expect([A().items.length, E().items.length]).toEqual([1, 0])
    undoAny() // рисунок 1
    expect([A().items.length, E().items.length]).toEqual([0, 0])
    undoAny() // больше нечего
    expect([A().items.length, E().items.length]).toEqual([0, 0])
  })

  it('повтор возвращает в обратном порядке', () => {
    A().add(arrow(1))
    E().add(ep(1, 1, 3))
    undoAny()
    undoAny()
    redoAny()
    expect([A().items.length, E().items.length]).toEqual([1, 0])
    redoAny()
    expect([A().items.length, E().items.length]).toEqual([1, 1])
    redoAny()
    expect([A().items.length, E().items.length]).toEqual([1, 1])
  })

  it('новое действие сбрасывает «повтор» обоих видов', () => {
    A().add(arrow(1))
    E().add(ep(1, 1, 3))
    undoAny() // эпизод в «повторе»
    A().add(arrow(2)) // новое действие
    redoAny() // повторять нечего
    expect(E().items).toHaveLength(0)
    expect(A().items).toHaveLength(2)
  })

  it('удаление эпизода отменяется вместе с остальной историей', () => {
    E().add(ep(1, 1, 3))
    A().add(arrow(1))
    E().remove(ep(1, 0, 0).id)
    expect(E().items).toHaveLength(0)
    undoAny()
    expect(E().items).toHaveLength(1)
    expect(A().items).toHaveLength(1)
    undoAny()
    expect(A().items).toHaveLength(0)
    expect(E().items).toHaveLength(1)
  })

  it('склеенные правки заметки — один шаг общей отмены', () => {
    E().add(ep(1, 1, 3))
    A().add(arrow(1))
    E().setNote(ep(1, 0, 0).id, 'а')
    E().setNote(ep(1, 0, 0).id, 'ab')
    undoAny()
    expect(E().items[0].note).toBeUndefined()
    undoAny()
    expect(A().items).toHaveLength(0)
    undoAny()
    expect(E().items).toHaveLength(0)
  })

  it('новое видео очищает обе истории', () => {
    A().add(arrow(1))
    E().add(ep(1, 1, 3))
    resetWork()
    expect([A().items.length, E().items.length]).toEqual([0, 0])
    undoAny()
    expect([A().items.length, E().items.length]).toEqual([0, 0])
    expect(A().past).toEqual([])
    expect(E().past).toEqual([])
  })
})

describe('оценки эпизодов', () => {
  const get = (n: number): Episode => E().items.find((e) => e.id === ep(n, 0, 1).id)!

  it('«хорошо» и «плохо» взаимоисключающи, повторный клик снимает', () => {
    E().add(ep(1, 1, 3))
    const id = ep(1, 1, 3).id
    E().toggleRating(id, 'good')
    expect(get(1).rating).toBe('good')
    E().toggleRating(id, 'bad')
    expect(get(1).rating).toBe('bad')
    E().toggleRating(id, 'bad')
    expect(get(1).rating).toBeNull()
  })

  it('«разобрать» не зависит от оценки', () => {
    E().add(ep(1, 1, 3))
    const id = ep(1, 1, 3).id
    E().toggleRating(id, 'good')
    E().toggleReview(id)
    expect(get(1)).toMatchObject({ rating: 'good', review: true })
    E().toggleRating(id, 'good')
    expect(get(1)).toMatchObject({ rating: null, review: true })
    E().toggleReview(id)
    expect(get(1).review).toBe(false)
  })

  it('неизвестный id ничего не меняет и не пишет в историю', () => {
    E().add(ep(1, 1, 3))
    const past = E().past.length
    E().toggleRating(ep(9, 1, 3).id, 'good')
    E().toggleReview(ep(9, 1, 3).id)
    expect(E().past.length).toBe(past)
  })

  it('отмена и повтор работают через общую историю', () => {
    E().add(ep(1, 1, 3))
    const id = ep(1, 1, 3).id
    E().toggleRating(id, 'bad')
    E().toggleReview(id)
    undoAny()
    expect(get(1)).toMatchObject({ rating: 'bad', review: false })
    undoAny()
    expect(get(1)).toMatchObject({ rating: null, review: false })
    redoAny()
    redoAny()
    expect(get(1)).toMatchObject({ rating: 'bad', review: true })
  })

  it('новый эпизод создаётся без оценки', () => {
    loadVideo(100, 50)
    applyTag('attack')
    expect(E().items[0]).toMatchObject({ rating: null, review: false })
  })

  it('горячие клавиши: выбранный эпизод, иначе последний созданный, иначе подсказка', () => {
    rateCurrent('good')
    expect(useFeedbackStore.getState().toast).toMatchObject({ kind: 'warn' })
    E().add(ep(1, 1, 3))
    E().add(ep(2, 10, 12))
    rateCurrent('bad')
    expect(get(2).rating).toBe('bad')
    expect(get(1).rating).toBeNull()
    E().select(ep(1, 1, 3).id)
    rateCurrent('review')
    expect(get(1).review).toBe(true)
    expect(get(2).review).toBe(false)
    // Подсказка после оценки позволяет оценить тот же эпизод кнопками.
    expect(useFeedbackStore.getState().toast?.episodeId).toBe(ep(1, 1, 3).id)
  })

  it('фильтры оценок: переключатель, общий сброс, замена из статистики', () => {
    E().toggleFilter('attack')
    E().toggleRatingFilter('good')
    E().toggleRatingFilter('none')
    expect(E().ratingFilter).toEqual(['good', 'none'])
    E().toggleRatingFilter('good')
    expect(E().ratingFilter).toEqual(['none'])
    E().clearFilters()
    expect(E().filter).toEqual([])
    expect(E().ratingFilter).toEqual([])
    E().toggleRatingFilter('bad')
    E().setFilter(['goal'])
    expect(E().filter).toEqual(['goal'])
    expect(E().ratingFilter).toEqual([])
  })

  it('загрузка проекта и сброс очищают фильтр оценок', () => {
    E().toggleRatingFilter('review')
    E().load([ep(1, 1, 3)])
    expect(E().ratingFilter).toEqual([])
    E().toggleRatingFilter('review')
    E().reset()
    expect(E().ratingFilter).toEqual([])
  })
})
