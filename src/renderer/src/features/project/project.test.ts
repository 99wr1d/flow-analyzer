import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_TAGS } from '../../../../shared/settings'
import { sampleAnnotation, sampleEpisode } from '../../../../shared/project.testkit'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { useEpisodesStore } from '../episodes/episodesStore'
import { installUnifiedHistory, loadWork, resetWork, undoAny } from '../history/unified'
import { installDirtyTracking, withoutDirty } from './dirty'
import { useProjectStore } from './projectStore'
import { buildTagSnapshot } from './snapshot'
import { answerUnsaved, askUnsaved, useUnsavedStore } from './unsavedStore'

const project = (): ReturnType<typeof useProjectStore.getState> => useProjectStore.getState()
const annotations = (): ReturnType<typeof useAnnotationsStore.getState> =>
  useAnnotationsStore.getState()
const episodes = (): ReturnType<typeof useEpisodesStore.getState> => useEpisodesStore.getState()

describe('признак «есть несохранённое»', () => {
  beforeEach(() => {
    installDirtyTracking()
    installUnifiedHistory()
    withoutDirty(resetWork)
    project().reset()
  })

  it('сначала проект чистый', () => {
    expect(project().dirty).toBe(false)
  })

  it('воспроизведение, перемотка, скорость и громкость проект не пачкают', () => {
    const player = usePlayerStore.getState()
    player.setPlaying(true)
    player.setCurrentTime(12)
    player.setPlaybackRate(2)
    player.setVolumeState(0.3, true)
    player.setPlaying(false)
    expect(project().dirty).toBe(false)
  })

  it('выбор, инструмент, метки и фильтр тоже не пачкают', () => {
    annotations().setTool('arrow')
    annotations().select(null)
    episodes().setIn(3)
    episodes().setOut(5)
    episodes().toggleFilter('goal')
    episodes().clearMarks()
    expect(project().dirty).toBe(false)
  })

  it('новый рисунок пачкает', () => {
    annotations().add(sampleAnnotation(1))
    expect(project().dirty).toBe(true)
  })

  it('новый эпизод пачкает', () => {
    episodes().add(sampleEpisode(1))
    expect(project().dirty).toBe(true)
  })

  it('правка заметки и границ, удаление — тоже', () => {
    withoutDirty(() => episodes().add(sampleEpisode(1)))
    expect(project().dirty).toBe(false)
    episodes().setNote(sampleEpisode(1).id, 'новая заметка')
    expect(project().dirty).toBe(true)
  })

  it('отмена и повтор пачкают (содержимое меняется)', () => {
    withoutDirty(() => annotations().add(sampleAnnotation(1)))
    expect(project().dirty).toBe(false)
    undoAny()
    expect(project().dirty).toBe(true)
  })

  it('загрузка проекта и сброс — не правки пользователя', () => {
    withoutDirty(() => loadWork([sampleAnnotation(1)], [sampleEpisode(1)]))
    expect(project().dirty).toBe(false)
    expect(annotations().items).toHaveLength(1)
    expect(episodes().items).toHaveLength(1)
    expect(annotations().past).toEqual([])
    withoutDirty(resetWork)
    expect(project().dirty).toBe(false)
  })

  it('сохранение снимает признак, но не если работа менялась во время записи', () => {
    annotations().add(sampleAnnotation(1))
    const version = project().version
    project().markSaved('/p/a.flowproj', 'a', 1, version)
    expect(project().dirty).toBe(false)
    expect(project().path).toBe('/p/a.flowproj')

    annotations().add(sampleAnnotation(2))
    const old = project().version - 1
    project().markSaved('/p/a.flowproj', 'a', 2, old)
    expect(project().dirty).toBe(true)
  })

  it('загруженный проект: имя, путь и признак из загрузки', () => {
    project().setLoaded({ path: '/p/x.flowproj', name: 'x', dirty: true, meta: null })
    expect(project()).toMatchObject({ path: '/p/x.flowproj', name: 'x', dirty: true })
    project().reset()
    expect(project()).toMatchObject({ path: null, name: 'Новый проект', dirty: false })
  })
})

describe('теги в файле проекта', () => {
  it('теги из настроек плюс теги, которые остались только в эпизодах', () => {
    const removed = {
      ...sampleEpisode(1),
      tagId: 'old-tag',
      tagName: 'Старый',
      tagColor: '#123456'
    }
    const tags = buildTagSnapshot(DEFAULT_TAGS, [sampleEpisode(2), removed, removed])
    expect(tags).toHaveLength(DEFAULT_TAGS.length + 1)
    expect(tags.find((t) => t.id === 'old-tag')).toMatchObject({ name: 'Старый', color: '#123456' })
    expect(tags.find((t) => t.id === 'goal')?.name).toBe('Гол')
  })

  it('настройки не меняются, лишнее не дублируется', () => {
    const before = JSON.stringify(DEFAULT_TAGS)
    buildTagSnapshot(DEFAULT_TAGS, [sampleEpisode(1)])
    expect(JSON.stringify(DEFAULT_TAGS)).toBe(before)
  })
})

describe('вопрос о несохранённом', () => {
  it('ответ приходит промисом и закрывает окно', async () => {
    const answer = askUnsaved()
    expect(useUnsavedStore.getState().open).toBe(true)
    answerUnsaved('discard')
    expect(await answer).toBe('discard')
    expect(useUnsavedStore.getState().open).toBe(false)
  })

  it('новый вопрос отменяет прежний', async () => {
    const first = askUnsaved()
    const second = askUnsaved()
    expect(await first).toBe('cancel')
    answerUnsaved('save')
    expect(await second).toBe('save')
  })
})
