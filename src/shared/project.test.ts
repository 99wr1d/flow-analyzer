import { describe, expect, it } from 'vitest'
import {
  MAX_ANNOTATIONS,
  MAX_EPISODES,
  MAX_PROJECT_BYTES,
  PROJECT_VERSION,
  ProjectSaveRequestSchema,
  migrateProject,
  parseProjectText,
  projectNameFromPath
} from './project'
import { sampleAnnotation, sampleEpisode, sampleProject, uuid } from './project.testkit'

const parse = (value: unknown): ReturnType<typeof parseProjectText> =>
  parseProjectText(JSON.stringify(value))

describe('схема проекта', () => {
  it('корректный проект читается без изменений', () => {
    const project = sampleProject()
    const result = parse(project)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project).toEqual(project)
  })

  it('необязательные поля можно опустить', () => {
    const project = sampleProject()
    const video = { ...project.video }
    delete video.fps
    delete video.fpsSource
    const rest: Partial<typeof project> = { ...project }
    delete rest.ui
    expect(
      parse({ ...rest, video, episodes: [{ ...project.episodes[0], note: undefined }] }).ok
    ).toBe(true)
  })

  it('BOM в начале файла допустим', () => {
    expect(parseProjectText('\ufeff' + JSON.stringify(sampleProject())).ok).toBe(true)
  })

  it('не JSON — понятная ошибка', () => {
    const result = parseProjectText('{ это не json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/повреждён/)
  })

  it('чужой JSON отклоняется', () => {
    for (const value of [[], null, 5, { hello: 1 }, { ...sampleProject(), format: 'other' }]) {
      const result = parse(value)
      expect(result.ok).toBe(false)
    }
  })

  it('неверные данные: рисунок вне 0..1, эпизод короче минимума, плохой цвет', () => {
    const a = sampleAnnotation()
    const bad = [
      { ...sampleProject(), annotations: [{ ...a, p1: { x: 2, y: 0 } }] },
      { ...sampleProject(), episodes: [{ ...sampleEpisode(), start: 1, end: 1.05 }] },
      { ...sampleProject(), episodes: [{ ...sampleEpisode(), tagColor: 'red' }] },
      { ...sampleProject(), createdAt: 'вчера' },
      { ...sampleProject(), video: { ...sampleProject().video, path: '' } }
    ]
    for (const value of bad) {
      const result = parse(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.details).toBeTruthy()
    }
  })

  it('повтор идентификатора отклоняется', () => {
    const project = sampleProject()
    const result = parse({ ...project, annotations: [sampleAnnotation(1), sampleAnnotation(1)] })
    expect(result.ok).toBe(false)
  })

  it('лимиты: больше 10 000 рисунков или эпизодов — ошибка, ровно предел — нормально', () => {
    const annotations = (n: number): ReturnType<typeof sampleAnnotation>[] =>
      Array.from({ length: n }, (_, i) => sampleAnnotation(i + 1))
    const episodes = (n: number): ReturnType<typeof sampleEpisode>[] =>
      Array.from({ length: n }, (_, i) => sampleEpisode(i + 1))
    expect(parse({ ...sampleProject(), annotations: annotations(MAX_ANNOTATIONS) }).ok).toBe(true)
    expect(parse({ ...sampleProject(), annotations: annotations(MAX_ANNOTATIONS + 1) }).ok).toBe(
      false
    )
    expect(parse({ ...sampleProject(), episodes: episodes(MAX_EPISODES) }).ok).toBe(true)
    expect(parse({ ...sampleProject(), episodes: episodes(MAX_EPISODES + 1) }).ok).toBe(false)
  })

  it('слишком длинный текст отклоняется до разбора', () => {
    const result = parseProjectText(' '.repeat(MAX_PROJECT_BYTES + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/слишком большой/)
  })
})

describe('миграция', () => {
  it('текущая версия проходит как есть', () => {
    const project = sampleProject()
    expect(migrateProject(project)).toEqual({ ok: true, data: project })
  })

  it('более новая версия — дружелюбная ошибка', () => {
    const result = migrateProject({ ...sampleProject(), version: PROJECT_VERSION + 1 })
    expect(result).toEqual({ ok: false, message: 'Файл создан более новой версией FlowAnalyzer' })
    const text = parse({ ...sampleProject(), version: 99 })
    expect(text.ok).toBe(false)
    if (!text.ok) expect(text.message).toBe('Файл создан более новой версией FlowAnalyzer')
  })

  it('нет версии, нулевая или дробная — ошибка', () => {
    for (const version of [undefined, 0, -1, 1.5, '1']) {
      expect(migrateProject({ ...sampleProject(), version }).ok).toBe(false)
    }
  })
})

describe('запрос сохранения', () => {
  const request = {
    videoId: uuid(77),
    annotations: [sampleAnnotation()],
    episodes: [sampleEpisode()],
    tags: [],
    lastTime: 3,
    currentPath: null
  }
  it('принимает корректные данные', () => {
    expect(ProjectSaveRequestSchema.safeParse(request).success).toBe(true)
  })
  it('отклоняет чужие поля и плохие значения', () => {
    expect(ProjectSaveRequestSchema.safeParse({ ...request, videoId: 'x' }).success).toBe(false)
    expect(ProjectSaveRequestSchema.safeParse({ ...request, lastTime: -1 }).success).toBe(false)
    expect(ProjectSaveRequestSchema.safeParse({ ...request, currentPath: '' }).success).toBe(false)
  })
})

describe('имя проекта по пути', () => {
  it('без папки и расширения', () => {
    expect(projectNameFromPath('C:\\Матчи\\Финал.flowproj')).toBe('Финал')
    expect(projectNameFromPath('/home/a/b.FLOWPROJ')).toBe('b')
    expect(projectNameFromPath('/x/plain')).toBe('plain')
    expect(projectNameFromPath('/x/.flowproj')).toBe('Новый проект')
  })
})
