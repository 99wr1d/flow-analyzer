import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTOSAVE_MS, parseAutosaveMs } from './autosave'
import { pickProjectArg, setLaunchPath, takeLaunchPath } from './launch'
import { checkTitleInput, composeTitle } from './title'

describe('заголовок окна', () => {
  it('без проекта — просто название, с проектом — имя и «*» при изменениях', () => {
    expect(composeTitle(null, false)).toBe('FlowAnalyzer')
    expect(composeTitle('Финал', false)).toBe('FlowAnalyzer — Финал')
    expect(composeTitle('Финал', true)).toBe('FlowAnalyzer — Финал*')
  })

  it('проверка входных данных', () => {
    expect(checkTitleInput('Финал', true)).toEqual({ name: 'Финал', dirty: true })
    expect(checkTitleInput(null, false)).toEqual({ name: null, dirty: false })
    expect(checkTitleInput('a\nb\u0007c', false)?.name).toBe('a b c')
    expect(checkTitleInput('', false)).toBeNull()
    expect(checkTitleInput('   ', false)).toBeNull()
    expect(checkTitleInput('x'.repeat(121), false)).toBeNull()
    expect(checkTitleInput(5, false)).toBeNull()
    expect(checkTitleInput('ok', 'yes')).toBeNull()
  })
})

describe('интервал автосохранения', () => {
  it('по умолчанию 2 минуты; разумное значение из переменной принимается', () => {
    expect(DEFAULT_AUTOSAVE_MS).toBe(120_000)
    expect(parseAutosaveMs(undefined)).toBe(120_000)
    expect(parseAutosaveMs('500')).toBe(500)
  })
  it('мусор и крайности игнорируются', () => {
    for (const bad of ['', 'abc', '-5', '10', '99999999', '1e3', '0']) {
      expect(parseAutosaveMs(bad)).toBe(DEFAULT_AUTOSAVE_MS)
    }
  })
})

describe('проект из командной строки', () => {
  const cwd = resolve('/cwd')
  const abs = join(resolve('/data'), 'a.flowproj')
  const existing = (...paths: string[]) => {
    const set = new Set(paths.map((p) => resolve(p)))
    return (p: string): Promise<boolean> => Promise.resolve(set.has(resolve(p)))
  }

  it('берёт первый существующий .flowproj, остальное пропускает', async () => {
    const argv = ['.', '--inspect=0', 'video.mp4', abs, join(resolve('/other'), 'b.flowproj')]
    expect(await pickProjectArg(argv, cwd, existing(abs))).toBe(abs)
  })

  it('относительный путь считается от рабочей папки', async () => {
    expect(await pickProjectArg(['p.FLOWPROJ'], cwd, existing(join(cwd, 'p.FLOWPROJ')))).toBe(
      join(cwd, 'p.FLOWPROJ')
    )
  })

  it('нет файла, не тот тип или флаг — null', async () => {
    expect(await pickProjectArg([abs], cwd, existing())).toBeNull()
    expect(await pickProjectArg(['a.txt', '--x.flowproj'], cwd, existing('a.txt'))).toBeNull()
    expect(await pickProjectArg([], cwd, existing())).toBeNull()
  })

  it('путь запуска выдаётся один раз', () => {
    setLaunchPath(abs)
    expect(takeLaunchPath()).toBe(abs)
    expect(takeLaunchPath()).toBeNull()
  })
})
