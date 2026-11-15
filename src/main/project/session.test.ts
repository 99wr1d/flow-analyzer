import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectSaveRequest } from '../../shared/project'
import { sampleAnnotation, sampleEpisode, uuid } from '../../shared/project.testkit'
import { getMediaEntry } from '../media/registry'
import { readLibrary } from '../library/store'
import { readProjectFile } from './files'
import { listRecent } from './recent'
import { listRecovery, recoveryFileName, RECOVERY_DIR } from './recovery'
import {
  autosave,
  buildProject,
  createProject,
  isTrustedPath,
  keyForPath,
  openProjectFile,
  relinkVideo,
  restoreFromRecovery,
  saveToPath,
  trustPath,
  videoFacts
} from './session'

let root: string
let userData: string
let videoPath: string
let projectPath: string

const request = (over: Partial<ProjectSaveRequest> = {}): ProjectSaveRequest => ({
  videoId: uuid(500),
  annotations: [sampleAnnotation(1), sampleAnnotation(2)],
  calibrations: [],
  episodes: [sampleEpisode(1)],
  tags: [],
  lastTime: 12.5,
  fps: 25,
  fpsSource: 'container',
  currentPath: null,
  ...over
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'flow-session-test-'))
  userData = join(root, 'userdata')
  await mkdir(join(root, 'videos'), { recursive: true })
  await mkdir(join(root, 'projects'), { recursive: true })
  videoPath = join(root, 'videos', 'match.mp4')
  projectPath = join(root, 'projects', 'game.flowproj')
  await writeFile(videoPath, Buffer.alloc(2048, 7))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

async function save(over: Partial<ProjectSaveRequest> = {}, target = projectPath): Promise<void> {
  await saveToPath(userData, request(over), await videoFacts(videoPath), target, '0.6.0')
}

describe('сборка и сохранение', () => {
  it('buildProject: пути, размер, время, версия приложения', () => {
    const now = new Date('2026-04-04T10:00:00Z')
    const project = buildProject(
      request(),
      { path: videoPath, sizeBytes: 2048 },
      projectPath,
      '0.6.0',
      '2026-01-01T00:00:00.000Z',
      now
    )
    expect(project.video).toMatchObject({
      path: videoPath,
      relativePath: '../videos/match.mp4',
      fileName: 'match.mp4',
      sizeBytes: 2048,
      fps: 25,
      fpsSource: 'container'
    })
    expect(project.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(project.updatedAt).toBe(now.toISOString())
    expect(project.ui).toEqual({ lastTime: 12.5 })
    expect(project.appVersion).toBe('0.6.0')
  })

  it('без пути проекта относительного пути нет', () => {
    const project = buildProject(
      request(),
      { path: videoPath, sizeBytes: 1 },
      null,
      '0.6.0',
      'x',
      new Date()
    )
    expect(project.video.relativePath).toBeNull()
  })

  it('сохранение создаёт валидный файл, запоминает проект и сохраняет дату создания', async () => {
    await save()
    const first = await readProjectFile(projectPath)
    expect(first.ok).toBe(true)
    await save({ lastTime: 99 })
    const second = await readProjectFile(projectPath)
    expect(second.ok && second.project.createdAt).toBe(first.ok && first.project.createdAt)
    expect(second.ok && second.project.ui?.lastTime).toBe(99)
    expect((await listRecent(userData)).map((r) => r.path)).toEqual([projectPath])
    expect(await isTrustedPath(userData, projectPath)).toBe(true)
  })

  it('после сохранения копии работы (старого и безымянного проекта) удаляются', async () => {
    const previous = join(root, 'projects', 'old.flowproj')
    await autosave(userData, request(), await videoFacts(videoPath), '0.6.0')
    await autosave(
      userData,
      request({ currentPath: previous }),
      await videoFacts(videoPath),
      '0.6.0'
    )
    expect(await listRecovery(userData)).toHaveLength(2)
    await save({ currentPath: previous })
    expect(await listRecovery(userData)).toEqual([])
  })

  it('автосохранение пишет копию и не трогает файл проекта', async () => {
    await save()
    const before = await readFile(projectPath, 'utf8')
    await autosave(
      userData,
      request({ currentPath: projectPath, lastTime: 77 }),
      await videoFacts(videoPath),
      '0.6.0'
    )
    expect(await readFile(projectPath, 'utf8')).toBe(before)
    const list = await listRecovery(userData)
    expect(list).toHaveLength(1)
    expect(list[0].key).toBe(keyForPath(projectPath))
    expect(list[0].projectPath).toBe(projectPath)
  })

  it('видео, которого нет на диске, — понятная ошибка', async () => {
    await expect(videoFacts(join(root, 'нет.mp4'))).rejects.toThrow(/не найден/)
  })
})

describe('открытие', () => {
  it('сохранённый проект открывается по абсолютному пути со всеми данными', async () => {
    await save()
    const result = await openProjectFile(userData, projectPath)
    expect(result.status).toBe('opened')
    if (result.status !== 'opened') return
    const p = result.project
    expect(p.path).toBe(projectPath)
    expect(p.name).toBe('game')
    expect(p.annotations).toEqual([sampleAnnotation(1), sampleAnnotation(2)])
    expect(p.episodes).toEqual([sampleEpisode(1)])
    expect(p.lastTime).toBe(12.5)
    expect(p.fps).toBe(25)
    expect(p.dirty).toBe(false)
    expect(p.warning).toBeNull()
    expect(p.source.fileName).toBe('match.mp4')
    expect(getMediaEntry(p.source.id)?.path).toBe(videoPath)
  })

  it('видео перенесли вместе с проектом: находится по относительному пути', async () => {
    await save()
    const moved = join(root, 'moved')
    await mkdir(join(moved, 'videos'), { recursive: true })
    await mkdir(join(moved, 'projects'), { recursive: true })
    await rename(videoPath, join(moved, 'videos', 'match.mp4'))
    const newProject = join(moved, 'projects', 'game.flowproj')
    await rename(projectPath, newProject)
    const result = await openProjectFile(userData, newProject)
    expect(result.status).toBe('opened')
    if (result.status === 'opened') {
      expect(getMediaEntry(result.project.source.id)?.path).toBe(join(moved, 'videos', 'match.mp4'))
      expect(result.project.dirty).toBe(false)
    }
  })

  it('видео нет нигде: video-missing, затем указание вручную; другой размер — предупреждение', async () => {
    await save()
    const other = join(root, 'elsewhere')
    await mkdir(other)
    const found = join(other, 'renamed.mp4')
    await rename(videoPath, found)
    await writeFile(found, Buffer.alloc(4096, 1)) // размер отличается

    const missing = await openProjectFile(userData, projectPath)
    expect(missing.status).toBe('video-missing')
    if (missing.status !== 'video-missing') return
    expect(missing.videoFileName).toBe('match.mp4')

    const bad = await relinkVideo(userData, missing.ticket, join(other, 'нет.mp4'))
    expect(bad.status).toBe('error')

    const opened = await relinkVideo(userData, missing.ticket, found)
    expect(opened.status).toBe('opened')
    if (opened.status === 'opened') {
      expect(opened.project.warning).toMatch(/Размер/)
      expect(opened.project.dirty).toBe(true)
      expect(opened.project.annotations).toHaveLength(2)
    }
    // Билет одноразовый.
    expect((await relinkVideo(userData, missing.ticket, found)).status).toBe('error')
  })

  it('чужой билет отклоняется', async () => {
    const result = await relinkVideo(userData, uuid(9), videoPath)
    expect(result.status).toBe('error')
  })

  it('повреждённый файл: ошибка, а не исключение', async () => {
    await writeFile(projectPath, '{{{', 'utf8')
    const result = await openProjectFile(userData, projectPath)
    expect(result.status).toBe('error')
  })

  it('видео неподходящего типа не принимается', async () => {
    await save()
    const text = (await readFile(projectPath, 'utf8')).replace('match.mp4', 'match.exe')
    await writeFile(projectPath, text, 'utf8')
    await writeFile(join(root, 'videos', 'match.exe'), 'x')
    const result = await openProjectFile(userData, projectPath)
    expect(['error', 'video-missing']).toContain(result.status)
  })
})

describe('доверенные пути', () => {
  it('чужой путь не доверенный, выбранный в диалоге — доверенный', async () => {
    const stranger = join(root, 'projects', 'stranger.flowproj')
    expect(await isTrustedPath(userData, stranger)).toBe(false)
    trustPath(stranger)
    expect(await isTrustedPath(userData, stranger)).toBe(true)
  })

  it('путь из списка недавних доверенный и после «перезапуска»', async () => {
    const remembered = join(root, 'projects', 'remembered.flowproj')
    await saveToPath(userData, request(), await videoFacts(videoPath), remembered, '0.6.0')
    expect(await isTrustedPath(userData, remembered)).toBe(true)
  })
})

describe('восстановление', () => {
  it('копия безымянного проекта открывается как несохранённая', async () => {
    await autosave(userData, request(), await videoFacts(videoPath), '0.6.0')
    const [item] = await listRecovery(userData)
    const result = await restoreFromRecovery(userData, item.key)
    expect(result.status).toBe('opened')
    if (result.status === 'opened') {
      expect(result.project.dirty).toBe(true)
      expect(result.project.path).toBeNull()
      expect(result.project.annotations).toHaveLength(2)
    }
    // Файл копии остаётся до сохранения или отказа.
    expect(await listRecovery(userData)).toHaveLength(1)
  })

  it('копия проекта с путём возвращает этот путь', async () => {
    await save()
    await autosave(
      userData,
      request({ currentPath: projectPath, annotations: [] }),
      await videoFacts(videoPath),
      '0.6.0'
    )
    const result = await restoreFromRecovery(userData, keyForPath(projectPath))
    expect(result.status).toBe('opened')
    if (result.status === 'opened') {
      expect(result.project.path).toBe(projectPath)
      expect(result.project.annotations).toEqual([])
      expect(result.project.dirty).toBe(true)
    }
  })

  it('нет такой копии — ошибка', async () => {
    const result = await restoreFromRecovery(userData, 'untitled-12345678')
    expect(result.status).toBe('error')
  })

  it('имя файла копии и папка соответствуют договорённости', () => {
    expect(recoveryFileName('untitled-0a0a0a0a')).toBe('untitled-0a0a0a0a.flowproj.recovery')
    expect(basename(dirname(join(userData, RECOVERY_DIR, 'x')))).toBe('recovery')
  })
})

describe('библиотека и описание проекта', () => {
  it('сохранение добавляет проект в библиотеку; путь становится доверенным без списка недавних', async () => {
    await save()
    const library = await readLibrary(userData)
    expect(library.map((i) => i.path)).toEqual([projectPath])
    await rm(join(userData, 'recent.json'), { force: true })
    expect(await isTrustedPath(userData, projectPath.toUpperCase())).toBe(
      process.platform === 'win32'
    )
    expect(await isTrustedPath(userData, projectPath)).toBe(true)
  })

  it('описание и длительность попадают в файл и возвращаются при открытии; название — имя проекта', async () => {
    const meta = { title: 'Финал', type: 'match' as const, date: '2026-05-17', notes: 'заметка' }
    const res = await saveToPath(
      userData,
      request({ meta, duration: 5400 }),
      await videoFacts(videoPath),
      projectPath,
      '0.10.0'
    )
    expect(res.name).toBe('Финал')
    const parsed = await readProjectFile(projectPath)
    expect(parsed.ok && parsed.project.meta).toEqual(meta)
    expect(parsed.ok && parsed.project.video.duration).toBe(5400)
    const opened = await openProjectFile(userData, projectPath)
    expect(opened.status === 'opened' && opened.project.meta).toEqual(meta)
    expect(opened.status === 'opened' && opened.project.name).toBe('Финал')
  })

  it('проект без описания: meta = null, имя — имя файла', async () => {
    await save()
    const opened = await openProjectFile(userData, projectPath)
    expect(opened.status).toBe('opened')
    if (opened.status !== 'opened') return
    expect(opened.project.meta).toBeNull()
    expect(opened.project.name).toBe('game')
  })

  it('createProject: файл в папке проектов, уникальное имя, проект открыт и записан в библиотеку', async () => {
    const folder = join(root, 'Документы', 'FlowAnalyzer')
    const make = (): ReturnType<typeof createProject> =>
      createProject(
        userData,
        folder,
        { title: 'Матч: Динамо / Спартак', type: 'match', date: '2026-05-17', videoId: uuid(1) },
        videoPath,
        '0.10.0'
      )
    const first = await make()
    const second = await make()
    expect(first.status).toBe('opened')
    expect(second.status).toBe('opened')
    if (first.status !== 'opened' || second.status !== 'opened') return
    expect(first.project.path).toBe(join(folder, 'Матч Динамо Спартак.flowproj'))
    expect(second.project.path).toBe(join(folder, 'Матч Динамо Спартак (2).flowproj'))
    expect(first.project.dirty).toBe(false)
    expect(first.project.name).toBe('Матч: Динамо / Спартак')
    expect(first.project.meta).toMatchObject({ type: 'match', date: '2026-05-17' })
    const onDisk = await readProjectFile(first.project.path as string)
    expect(onDisk.ok && onDisk.project.episodes).toEqual([])
    expect((await readLibrary(userData)).map((i) => i.path).sort()).toEqual(
      [first.project.path, second.project.path].sort()
    )
  })
})
