// Совместимость файлов проектов: по одному файлу на каждую эпоху формата (tests/fixtures/projects).
// Каждый файл открывается без ошибок, данные сохраняются, повторное сохранение даёт файл текущего формата, который снова открывается.
import { readdirSync } from 'fs'
import {
  mkdir as mkdirP,
  mkdtemp as mkdtempP,
  readFile as readFileP,
  rm as rmP,
  writeFile as writeFileP
} from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isAnimated } from '../../shared/animation'
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  parseProjectText,
  type LoadedProject,
  type Project,
  type ProjectSaveRequest
} from '../../shared/project'
import { readProjectFile } from './files'
import { openProjectFile, saveToPath, videoFacts } from './session'

const DIR = resolve('tests/fixtures/projects')
const CURRENT_APP_VERSION = '0.16.3'

interface Era {
  file: string
  appVersion: string
  annotations: number
  calibrations: number
  episodes: number
  meta: boolean
  grassKey: boolean
  /** Типы рисунков, которые должны быть в файле. */
  types: string[]
  animated: number
}

const ERAS: Era[] = [
  {
    file: 'v0.6.0.flowproj',
    appVersion: '0.6.0',
    annotations: 3,
    calibrations: 0,
    episodes: 2,
    meta: false,
    grassKey: false,
    types: ['arrow', 'circle', 'text'],
    animated: 0
  },
  {
    file: 'v0.9.0.flowproj',
    appVersion: '0.9.0',
    annotations: 2,
    calibrations: 0,
    episodes: 3,
    meta: false,
    grassKey: false,
    types: ['line', 'circle'],
    animated: 0
  },
  {
    file: 'v0.10.0.flowproj',
    appVersion: '0.10.0',
    annotations: 1,
    calibrations: 0,
    episodes: 3,
    meta: true,
    grassKey: false,
    types: ['arrow'],
    animated: 0
  },
  {
    file: 'v0.11.0.flowproj',
    appVersion: '0.11.0',
    annotations: 3,
    calibrations: 1,
    episodes: 1,
    meta: true,
    grassKey: false,
    types: ['arrow', 'ring', 'ruler'],
    animated: 0
  },
  {
    file: 'v0.13.0.flowproj',
    appVersion: '0.13.0',
    annotations: 4,
    calibrations: 1,
    episodes: 1,
    meta: true,
    grassKey: true,
    types: ['arrow', 'ring', 'pzone', 'spot'],
    animated: 0
  },
  {
    file: 'v0.14.0.flowproj',
    appVersion: '0.14.0',
    annotations: 4,
    calibrations: 1,
    episodes: 2,
    meta: true,
    grassKey: true,
    types: ['arrow', 'ring', 'pen', 'loupe'],
    animated: 2
  }
]

let root: string
let userData: string
let video: string

beforeEach(async () => {
  root = await mkdtempP(join(tmpdir(), 'flow-compat-'))
  userData = join(root, 'userdata')
  await mkdirP(join(root, 'p'), { recursive: true })
  video = join(root, 'cfr25.mp4')
  await writeFileP(video, Buffer.alloc(2048, 7))
})
afterEach(async () => {
  await rmP(root, { recursive: true, force: true })
})

/** Копия файла эпохи с видео, которое есть на этом компьютере. */
async function install(era: Era): Promise<string> {
  const raw = JSON.parse(await readFileP(join(DIR, era.file), 'utf8')) as Project
  raw.video.path = video
  raw.video.relativePath = null
  raw.video.sizeBytes = 2048
  const target = join(root, 'p', era.file)
  await writeFileP(target, JSON.stringify(raw, null, 2), 'utf8')
  return target
}

const requestFrom = (loaded: LoadedProject): ProjectSaveRequest => ({
  videoId: loaded.source.id,
  annotations: loaded.annotations,
  calibrations: loaded.calibrations,
  episodes: loaded.episodes,
  tags: loaded.tags,
  lastTime: loaded.lastTime,
  ...(loaded.fps !== undefined ? { fps: loaded.fps } : {}),
  ...(loaded.fpsSource !== undefined ? { fpsSource: loaded.fpsSource } : {}),
  ...(loaded.meta ? { meta: loaded.meta } : {}),
  ...(loaded.grassKey ? { grassKey: loaded.grassKey } : {}),
  currentPath: loaded.path
})

describe('файлы проектов прошлых версий', () => {
  it('на каждую эпоху формата есть файл', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.flowproj'))
    expect(files.sort()).toEqual(ERAS.map((e) => e.file).sort())
  })

  for (const era of ERAS) {
    describe(`версия ${era.appVersion}`, () => {
      it('читается схемой без ошибок, данные на месте', async () => {
        const parsed = await readProjectFile(join(DIR, era.file))
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return
        const p = parsed.project
        expect(p.appVersion).toBe(era.appVersion)
        expect(p.annotations).toHaveLength(era.annotations)
        expect(p.calibrations).toHaveLength(era.calibrations)
        expect(p.episodes).toHaveLength(era.episodes)
        expect(p.annotations.map((a) => a.type)).toEqual(era.types)
        expect(p.meta !== undefined).toBe(era.meta)
        expect(p.grassKey !== undefined).toBe(era.grassKey)
        expect(p.annotations.filter((a) => isAnimated(a))).toHaveLength(era.animated)
      })

      it('поля, которых не было в старом формате, получают значения по умолчанию', async () => {
        const parsed = await readProjectFile(join(DIR, era.file))
        if (!parsed.ok) throw new Error(parsed.message)
        for (const e of parsed.project.episodes) {
          expect(e.rating === null || e.rating === 'good' || e.rating === 'bad').toBe(true)
          expect(typeof e.review).toBe('boolean')
        }
        for (const a of parsed.project.annotations) {
          expect(a.space === 'screen' || a.space === 'pitch').toBe(true)
          if (a.timing.mode === 'frame') {
            expect(a.timing.freezeSeconds).toBeGreaterThanOrEqual(0.5)
          }
        }
      })

      it('открывается через приложение, сохраняется заново в текущем формате и открывается снова', async () => {
        const path = await install(era)
        const first = await openProjectFile(userData, path)
        expect(first.status).toBe('opened')
        if (first.status !== 'opened') return
        const before = await readProjectFile(path)
        if (!before.ok) throw new Error(before.message)
        // Все данные прошли в интерфейс.
        expect(first.project.annotations).toEqual(before.project.annotations)
        expect(first.project.episodes).toEqual(before.project.episodes)
        expect(first.project.calibrations).toEqual(before.project.calibrations)
        expect(first.project.lastTime).toBe(before.project.ui?.lastTime)

        // Сохранение поверх того же файла, как делает Ctrl+S.
        const out = path
        await saveToPath(
          userData,
          requestFrom(first.project),
          await videoFacts(video),
          out,
          CURRENT_APP_VERSION
        )

        const text = await readFileP(out, 'utf8')
        const raw = JSON.parse(text) as Record<string, unknown>
        expect(raw.format).toBe(PROJECT_FORMAT)
        expect(raw.version).toBe(PROJECT_VERSION)
        expect(raw.appVersion).toBe(CURRENT_APP_VERSION)
        // Текущий формат: поле calibrations есть всегда, у эпизодов — оценки.
        expect(Array.isArray(raw.calibrations)).toBe(true)
        for (const e of raw.episodes as Array<Record<string, unknown>>) {
          expect('rating' in e && 'review' in e).toBe(true)
        }

        const reread = parseProjectText(text)
        expect(reread.ok).toBe(true)
        if (!reread.ok) return
        expect(reread.project.annotations).toEqual(before.project.annotations)
        expect(reread.project.episodes).toEqual(before.project.episodes)
        expect(reread.project.calibrations).toEqual(before.project.calibrations)
        expect(reread.project.tags).toEqual(before.project.tags)
        expect(reread.project.meta).toEqual(before.project.meta)
        expect(reread.project.grassKey).toEqual(before.project.grassKey)
        expect(reread.project.ui).toEqual(before.project.ui)
        // Дата создания сохраняется (файл тот же по смыслу), дата изменения новая.
        expect(reread.project.createdAt).toBe(before.project.createdAt)

        const second = await openProjectFile(userData, out)
        expect(second.status).toBe('opened')
        if (second.status !== 'opened') return
        expect(second.project.annotations).toEqual(first.project.annotations)
        expect(second.project.episodes).toEqual(first.project.episodes)
      })
    })
  }
})
