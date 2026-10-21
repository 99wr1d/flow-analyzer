import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_THUMB_BYTES, type LibraryCard } from '../../shared/library'
import { ProjectSchema, parseProjectText, resolveMeta } from '../../shared/project'
import { sampleProject } from '../../shared/project.testkit'
import { FIXTURE } from '../ffmpeg/ffmpeg.testkit'
import { getFfmpegPath } from '../ffmpeg/path'
import { sanitizeFileStem, uniqueFileName } from '../ffmpeg/names'
import { buildCards, summarizeProject } from './cards'
import { resolveProjectsFolder } from './folder'
import { updateMetaInFile } from './meta'
import { isInsideFolder, scanProjectsFolder } from './scan'
import {
  LIBRARY_FILE,
  MAX_LIBRARY_ITEMS,
  mergeEntries,
  readLibrary,
  rememberInLibrary,
  removeItem,
  replaceItemPath,
  touchItem,
  updateLibrary
} from './store'
import {
  generateThumb,
  readThumb,
  scheduleThumb,
  settleThumbs,
  thumbFile,
  thumbKey,
  thumbTime
} from './thumbs'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'flow-library-test-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const dir = (name: string): string => {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}
const writeProject = (path: string, patch: object = {}): void =>
  writeFileSync(path, JSON.stringify({ ...sampleProject(), ...patch }), 'utf8')

describe('библиотека: чистые операции', () => {
  const t1 = new Date('2026-03-01T10:00:00.000Z')
  const t2 = new Date('2026-03-02T10:00:00.000Z')

  it('новый проект добавляется, повторный — обновляет время и не дублируется', () => {
    const a = touchItem([], 'C:\\Проекты\\a.flowproj', t1)
    expect(a).toEqual([
      { path: 'C:\\Проекты\\a.flowproj', addedAt: t1.toISOString(), lastOpenedAt: t1.toISOString() }
    ])
    const b = touchItem(a, 'C:\\Проекты\\b.flowproj', t1)
    const again = touchItem(b, 'C:\\Проекты\\a.flowproj', t2)
    expect(again).toHaveLength(2)
    expect(again[0].path).toBe('C:\\Проекты\\a.flowproj')
    expect(again[0].addedAt).toBe(t1.toISOString())
    expect(again[0].lastOpenedAt).toBe(t2.toISOString())
  })

  it('дубли по пути без учёта регистра и вида слэшей (Windows)', () => {
    if (process.platform !== 'win32') return
    const a = touchItem([], 'C:\\X\\a.flowproj', t1)
    expect(touchItem(a, 'c:/x/A.FLOWPROJ', t2)).toHaveLength(1)
  })

  it('убрать и переместить путь', () => {
    const list = touchItem(touchItem([], '/p/a.flowproj', t1), '/p/b.flowproj', t1)
    expect(removeItem(list, '/p/a.flowproj').map((i) => i.path)).toEqual(['/p/b.flowproj'])
    const moved = replaceItemPath(list, '/p/a.flowproj', '/q/a.flowproj', t2)
    expect(moved.map((i) => i.path).sort()).toEqual(['/p/b.flowproj', '/q/a.flowproj'])
    expect(moved.find((i) => i.path === '/q/a.flowproj')?.addedAt).toBe(t1.toISOString())
  })

  it('число записей не ограничено «недавними»: выше 10, но с верхним пределом', () => {
    let list = touchItem([], '/p/0.flowproj', t1)
    for (let i = 1; i < 25; i++) list = touchItem(list, `/p/${i}.flowproj`, t1)
    expect(list).toHaveLength(25)
    expect(MAX_LIBRARY_ITEMS).toBeGreaterThan(1000)
  })

  it('объединение с найденными в папке: без повторов, у найденных нет lastOpenedAt', () => {
    const lib = touchItem([], '/p/a.flowproj', t1)
    const merged = mergeEntries(lib, [
      { path: '/p/a.flowproj', modifiedAt: t2.toISOString() },
      { path: '/p/new.flowproj', modifiedAt: t2.toISOString() }
    ])
    expect(merged).toHaveLength(2)
    const found = merged.find((m) => m.path === '/p/new.flowproj')
    expect(found).toMatchObject({ inLibrary: false, lastOpenedAt: null })
    expect(merged.find((m) => m.path === '/p/a.flowproj')?.inLibrary).toBe(true)
  })
})

describe('library.json на диске', () => {
  it('запись, чтение, повреждённый файл даёт пустой список', async () => {
    const ud = dir('ud1')
    expect(await readLibrary(ud)).toEqual([])
    await rememberInLibrary(ud, '/p/a.flowproj', new Date('2026-03-01T10:00:00.000Z'))
    await rememberInLibrary(ud, '/p/b.flowproj')
    expect((await readLibrary(ud)).map((i) => i.path)).toEqual(['/p/b.flowproj', '/p/a.flowproj'])
    await updateLibrary(ud, (list) => removeItem(list, '/p/a.flowproj'))
    expect(await readLibrary(ud)).toHaveLength(1)
    writeFileSync(join(ud, LIBRARY_FILE), '{не json', 'utf8')
    expect(await readLibrary(ud)).toEqual([])
    writeFileSync(join(ud, LIBRARY_FILE), JSON.stringify({ version: 2, items: [] }), 'utf8')
    expect(await readLibrary(ud)).toEqual([])
  })

  it('быстрые подряд записи не теряют друг друга', async () => {
    const ud = dir('ud2')
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => rememberInLibrary(ud, `/p/${i}.flowproj`))
    )
    expect(await readLibrary(ud)).toHaveLength(12)
  })
})

describe('поиск проектов в папке', () => {
  it('сама папка и подпапки первого уровня; глубже — нет; чужие файлы и скрытые — нет', async () => {
    const folder = dir('scan1')
    writeProject(join(folder, 'a.flowproj'))
    writeProject(join(folder, 'B.FLOWPROJ'))
    writeFileSync(join(folder, 'заметки.txt'), 'x')
    writeProject(join(folder, '.hidden.flowproj'))
    mkdirSync(join(folder, 'Матч 1'))
    writeProject(join(folder, 'Матч 1', 'c.flowproj'))
    mkdirSync(join(folder, 'Матч 1', 'глубже'))
    writeProject(join(folder, 'Матч 1', 'глубже', 'd.flowproj'))
    const found = (await scanProjectsFolder(folder)).map((f) => f.path.slice(folder.length + 1))
    expect(found.sort()).toEqual(['B.FLOWPROJ', 'a.flowproj', join('Матч 1', 'c.flowproj')].sort())
  })

  it('нет папки — пустой результат', async () => {
    expect(await scanProjectsFolder(join(root, 'нет-такой'))).toEqual([])
  })

  it('isInsideFolder: папка и подпапка первого уровня', () => {
    const base = join(root, 'F')
    expect(isInsideFolder(base, join(base, 'a.flowproj'))).toBe(true)
    expect(isInsideFolder(base, join(base, 'sub', 'a.flowproj'))).toBe(true)
    expect(isInsideFolder(base, join(base, 'sub', 'deep', 'a.flowproj'))).toBe(false)
    expect(isInsideFolder(base, join(root, 'other', 'a.flowproj'))).toBe(false)
  })

  it('папка по умолчанию: Документы\\FlowAnalyzer или абсолютное переопределение', () => {
    expect(resolveProjectsFolder(join('C:', 'Docs'), undefined)).toBe(
      join('C:', 'Docs', 'FlowAnalyzer')
    )
    expect(resolveProjectsFolder('X', join(root, 'override'))).toBe(join(root, 'override'))
    expect(resolveProjectsFolder(join('C:', 'Docs'), 'относительный')).toBe(
      join('C:', 'Docs', 'FlowAnalyzer')
    )
  })
})

describe('описание проекта (meta)', () => {
  it('старые файлы без meta читаются; название — имя файла, тип — «Другое»', () => {
    const old = JSON.stringify(sampleProject())
    const parsed = parseProjectText(old)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.project.meta).toBeUndefined()
    expect(resolveMeta(parsed.project.meta, 'Матч-1')).toEqual({ title: 'Матч-1', type: 'other' })
  })

  it('корректное описание проходит, мусор отклоняется', () => {
    const base = sampleProject()
    const ok = (meta: unknown): boolean => ProjectSchema.safeParse({ ...base, meta }).success
    expect(ok({ title: 'Финал', type: 'match', date: '2026-05-17', notes: 'ничего' })).toBe(true)
    expect(ok({ title: '  ', type: 'match' })).toBe(false)
    expect(ok({ title: 'я'.repeat(81), type: 'match' })).toBe(false)
    expect(ok({ title: 'Ок', type: 'friendly' })).toBe(false)
    expect(ok({ title: 'Ок', type: 'match', date: '2026-02-30' })).toBe(false)
    expect(ok({ title: 'Ок', type: 'match', date: '17.05.2026' })).toBe(false)
    expect(ok({ title: 'Ок', type: 'match', notes: 'я'.repeat(501) })).toBe(false)
    expect(ok({ title: 'А\u0000Б', type: 'match' })).toBe(false)
  })

  it('сводка: название, тип, дата, число эпизодов и рисунков, имя видео', () => {
    const project = {
      ...sampleProject(),
      meta: { title: 'Финал', type: 'match' as const, date: '2026-05-17' }
    }
    project.video.duration = 5400
    expect(summarizeProject(project, '/p/x.flowproj')).toMatchObject({
      title: 'Финал',
      type: 'match',
      date: '2026-05-17',
      hasMeta: true,
      videoFileName: 'match.mp4',
      videoDuration: 5400,
      episodes: 1,
      drawings: 1
    })
    const bare = summarizeProject(sampleProject(), join('p', 'Тренировка 3.flowproj'))
    expect(bare).toMatchObject({ title: 'Тренировка 3', type: 'other', hasMeta: false })
    expect(bare.date).toBeUndefined()
  })

  it('правка описания в файле: остальное содержимое не меняется', async () => {
    const file = join(dir('meta'), 'p.flowproj')
    writeProject(file)
    await updateMetaInFile(file, { title: 'Новое', type: 'training', notes: 'заметка' })
    const back = JSON.parse(readFileSync(file, 'utf8'))
    expect(back.meta).toEqual({ title: 'Новое', type: 'training', notes: 'заметка' })
    expect(back.episodes).toHaveLength(1)
    await expect(
      updateMetaInFile(join(root, 'нет.flowproj'), { title: 'x', type: 'other' })
    ).rejects.toThrow()
  })
})

describe('имя файла проекта', () => {
  it('очищается от запрещённых символов, пробелы сохраняются', () => {
    expect(sanitizeFileStem('Матч: «Динамо» / Спартак?')).toBe('Матч «Динамо» Спартак')
    expect(sanitizeFileStem('  ...  ')).toBe('Проект')
    expect(sanitizeFileStem('CON')).toBe('_CON')
    expect(sanitizeFileStem('я'.repeat(200)).length).toBeLessThanOrEqual(100)
  })

  it('уникальное имя: «(2)», «(3)»', () => {
    const taken = new Set(['Матч.flowproj', 'Матч (2).flowproj'])
    expect(uniqueFileName('Матч', 'flowproj', (n) => taken.has(n))).toBe('Матч (3).flowproj')
    expect(uniqueFileName('Другой', 'flowproj', (n) => taken.has(n))).toBe('Другой.flowproj')
  })
})

describe('карточки: чтение папки и библиотеки', () => {
  it('нормальный, повреждённый, пропавший и найденный в папке проекты', async () => {
    const ud = dir('cards-ud')
    const folder = dir('cards-folder')
    const elsewhere = dir('cards-else')
    const good = join(elsewhere, 'good.flowproj')
    const broken = join(elsewhere, 'broken.flowproj')
    const missing = join(elsewhere, 'gone.flowproj')
    const scannedOnly = join(folder, 'Найденный.flowproj')
    writeProject(good, { meta: { title: 'Хороший', type: 'match' } })
    writeFileSync(broken, '{"format": "нет"}', 'utf8')
    writeProject(scannedOnly)
    await rememberInLibrary(ud, good)
    await rememberInLibrary(ud, broken)
    await rememberInLibrary(ud, missing)
    await rememberInLibrary(ud, scannedOnly)

    const cards = await buildCards(ud, folder)
    expect(cards).toHaveLength(4)
    const by = (path: string): LibraryCard => cards.find((c) => c.path === path)!
    expect(by(good)).toMatchObject({
      status: 'ok',
      title: 'Хороший',
      type: 'match',
      inDefaultFolder: false,
      episodes: 1
    })
    expect(by(broken).status).toBe('error')
    expect(by(broken).error).toMatch(/файл проекта|проект/i)
    expect(by(missing)).toMatchObject({ status: 'missing', title: 'gone' })
    expect(by(scannedOnly)).toMatchObject({
      status: 'ok',
      inDefaultFolder: true,
      title: 'Найденный'
    })
    // В карточках нет ни рисунков, ни эпизодов целиком.
    expect(JSON.stringify(cards)).not.toContain('"annotations"')
  })

  it('сводки кэшируются, пока файл не изменился; правка и порча файла видны сразу', async () => {
    const ud = dir('cache-ud')
    const folder = dir('cache-folder')
    const path = join(dir('cache-else'), 'p.flowproj')
    writeProject(path, { meta: { title: 'Первый', type: 'match' } })
    await rememberInLibrary(ud, path)
    const first = await buildCards(ud, folder)
    expect(first[0]).toMatchObject({ status: 'ok', title: 'Первый' })

    // Файл не менялся: тот же результат (из кэша).
    expect((await buildCards(ud, folder))[0]).toMatchObject({ status: 'ok', title: 'Первый' })

    // Изменили описание (размер и время файла другие): карточка обновилась.
    await updateMetaInFile(path, { title: 'Второй, подлиннее', type: 'training' })
    expect((await buildCards(ud, folder))[0]).toMatchObject({
      status: 'ok',
      title: 'Второй, подлиннее',
      type: 'training'
    })

    // Файл испортили: кэш не прячет ошибку.
    writeFileSync(path, '{"format": "нет"}', 'utf8')
    expect((await buildCards(ud, folder))[0].status).toBe('error')
  })
})

const ffmpeg = getFfmpegPath()
describe.skipIf(!ffmpeg.ok)('эскизы (настоящий ffmpeg)', () => {
  it('время кадра: место просмотра, иначе 10% длительности, иначе секунда', () => {
    expect(thumbTime(12, 100)).toBe(12)
    expect(thumbTime(0, 100)).toBe(10)
    expect(thumbTime(0, undefined)).toBe(1)
    expect(thumbTime(500, 100)).toBeCloseTo(99.8)
  })

  it('обложка проекта важнее всего; без неё — середина самого раннего эпизода', () => {
    const episodes = [
      { start: 50, end: 60 },
      { start: 10, end: 20 }
    ]
    expect(thumbTime(12, 100, { cover: 30, episodes })).toBe(30)
    expect(thumbTime(0, 100, { cover: 0, episodes })).toBe(0)
    expect(thumbTime(12, 100, { cover: 500 })).toBeCloseTo(99.8)
    expect(thumbTime(77, 100, { episodes })).toBe(15)
    expect(thumbTime(77, 100, { episodes: [] })).toBe(77)
  })

  it('JPEG создаётся, меньше 60 КБ и начинается с сигнатуры JPEG', async () => {
    const out = join(dir('thumbs1'), 'a.jpg')
    const ok = await generateThumb({
      ffmpegPath: ffmpeg.ok ? ffmpeg.path : '',
      videoPath: FIXTURE('cfr25.mp4'),
      time: 1,
      out
    })
    expect(ok).toBe(true)
    const bytes = readFileSync(out)
    expect(bytes.length).toBeGreaterThan(500)
    expect(bytes.length).toBeLessThan(MAX_THUMB_BYTES)
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8])
  })

  it('время за концом видео — берётся начало', async () => {
    const out = join(dir('thumbs2'), 'a.jpg')
    const ok = await generateThumb({
      ffmpegPath: ffmpeg.ok ? ffmpeg.path : '',
      videoPath: FIXTURE('cfr25.mp4'),
      time: 9999,
      out
    })
    expect(ok).toBe(true)
  })

  it('битое видео — эскиза нет, ошибки нет', async () => {
    const out = join(dir('thumbs3'), 'a.jpg')
    const ok = await generateThumb({
      ffmpegPath: ffmpeg.ok ? ffmpeg.path : '',
      videoPath: FIXTURE('broken.mp4'),
      time: 1,
      out
    })
    expect(ok).toBe(false)
  })

  it('scheduleThumb кладёт файл в userData/thumbs/<sha1>.jpg; список ждёт его и отдаёт байты', async () => {
    const ud = dir('thumbs4')
    const project = join(dir('thumbs4-proj'), 'p.flowproj')
    scheduleThumb(ud, project, FIXTURE('cfr25.mp4'), 0, 4)
    await settleThumbs()
    const file = thumbFile(ud, project)
    expect(file.endsWith(`${thumbKey(project)}.jpg`)).toBe(true)
    expect(thumbKey(project)).toMatch(/^[0-9a-f]{40}$/)
    const bytes = await readThumb(ud, project)
    expect(bytes).not.toBeNull()
    expect(bytes!.length).toBeLessThan(MAX_THUMB_BYTES)
  })
})
