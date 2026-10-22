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
import { isAnimated, keysOf } from '../../shared/animation'
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
const CURRENT_APP_VERSION = '0.18.0'

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
  },
  {
    file: 'v0.17.0.flowproj',
    appVersion: '0.17.0',
    annotations: 6,
    calibrations: 1,
    episodes: 2,
    meta: true,
    grassKey: true,
    types: ['ring', 'circle', 'text', 'arrow', 'pspot', 'spot'],
    animated: 1
  },
  {
    file: 'v0.18.0.flowproj',
    appVersion: '0.18.0',
    annotations: 6,
    calibrations: 1,
    episodes: 2,
    meta: true,
    grassKey: true,
    types: ['ring', 'circle', 'text', 'arrow', 'pspot', 'spot'],
    animated: 1
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

describe('ключи слежения (auto)', () => {
  /** Проект 0.14.0, у которого стрелка получает заданные ключи. */
  async function withKeys(keys: unknown[]): Promise<string> {
    const raw = JSON.parse(await readFileP(join(DIR, 'v0.14.0.flowproj'), 'utf8')) as Project
    raw.appVersion = '0.16.4'
    const arrow = raw.annotations.find((a) => a.type === 'arrow') as unknown as {
      keyframes: unknown[]
      timing: { duration: number }
    }
    arrow.keyframes = keys
    arrow.timing.duration = 60
    return JSON.stringify(raw)
  }
  const key = (i: number, auto: boolean): unknown => ({
    t: 1 + i * 0.02,
    ease: 'linear',
    geom: { p1: { x: 0.1, y: 0.2 }, p2: { x: 0.6, y: 0.4 } },
    ...(auto ? { auto: true } : {})
  })

  it('проект 0.16.4 без поля auto читается, ключи остаются ручными', async () => {
    const parsed = parseProjectText(await withKeys([key(0, false), key(1, false)]))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const arrow = parsed.project.annotations.find((a) => a.type === 'arrow')
    expect(keysOf(arrow as object)).toHaveLength(2)
    expect(keysOf(arrow as object).every((k) => k.auto === undefined)).toBe(true)
  })

  it('проект с 2500 ключами слежения проходит схему, auto сохраняется', async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => key(i, true))
    const parsed = parseProjectText(await withKeys(keys))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const arrow = parsed.project.annotations.find((a) => a.type === 'arrow')
    expect(keysOf(arrow as object)).toHaveLength(2500)
    expect(keysOf(arrow as object).every((k) => k.auto === true)).toBe(true)
  })

  it('больше 3000 ключей не принимается', async () => {
    const keys = Array.from({ length: 3001 }, (_, i) => key(i, true))
    expect(parseProjectText(await withKeys(keys)).ok).toBe(false)
  })
})

describe('стили 0.18: проект 0.17.0 без новых полей', () => {
  const NEW_KEYS = ['glow', 'look', 'pulse', 'form', 'reveal', 'shadow']

  it('читается и сохраняется без появления новых полей (старый вид)', async () => {
    const path = await install(ERAS.find((e) => e.appVersion === '0.17.0')!)
    const opened = await openProjectFile(userData, path)
    expect(opened.status).toBe('opened')
    if (opened.status !== 'opened') return
    await saveToPath(userData, requestFrom(opened.project), await videoFacts(video), path, '0.18.0')
    const raw = JSON.parse(await readFileP(path, 'utf8')) as Project
    expect(raw.annotations).toHaveLength(6)
    for (const a of raw.annotations) {
      const rec = a as unknown as Record<string, unknown>
      for (const k of NEW_KEYS) expect(k in rec, `${a.type}.${k}`).toBe(false)
      expect(rec.style as object).not.toHaveProperty('shadow')
    }
    const text = raw.annotations.find((a) => a.type === 'text')
    expect(text && 'style' in text && (text.style as { background: boolean }).background).toBe(true)
    const arrow = raw.annotations.find((a) => a.type === 'arrow')
    expect(arrow && arrow.style.dash).toBe('dashed')
  })

  it('проект с новыми полями читается, поля сохраняются', async () => {
    const raw = JSON.parse(await readFileP(join(DIR, 'v0.17.0.flowproj'), 'utf8')) as Project
    const set = (type: string, extra: object): void => {
      const a = raw.annotations.find((x) => x.type === type)
      Object.assign(a as object, extra)
    }
    set('ring', { glow: true, look: 'target', pulse: true })
    set('arrow', { glow: true, reveal: 0.8 })
    set('pspot', { form: 'pillar' })
    set('text', { style: { color: '#c6ff3d', size: 0.045, background: false, shadow: true } })
    const parsed = parseProjectText(JSON.stringify(raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const by = (t: string): Record<string, unknown> =>
      parsed.project.annotations.find((x) => x.type === t) as unknown as Record<string, unknown>
    expect(by('ring')).toMatchObject({ glow: true, look: 'target', pulse: true })
    expect(by('arrow')).toMatchObject({ glow: true, reveal: 0.8 })
    expect(by('pspot')).toMatchObject({ form: 'pillar' })
    expect(by('text').style).toMatchObject({ background: false, shadow: true })
  })
})

/** Штриховка рисунка (у подписи её нет). */
const dashOf = (a: unknown): unknown => (a as { style?: { dash?: unknown } }).style?.dash

describe('стили 0.18: пунктир «точки» в файле', () => {
  it('в файле это dash «dashed» + dots (старые версии откроют проект и покажут штрих), в памяти — «dotted»', async () => {
    const fixture = await readFileP(join(DIR, 'v0.18.0.flowproj'), 'utf8')
    // В самом файле эпохи 0.18.0 нет значения «dotted» (его не прочтёт ни одна старая версия).
    expect(fixture).not.toContain('"dotted"')
    const parsed = parseProjectText(fixture)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const dotted = parsed.project.annotations.filter((a) => dashOf(a) === 'dotted')
    expect(dotted).toHaveLength(1)
    expect(dotted[0].style).not.toHaveProperty('dots')

    const path = await install(ERAS.find((e) => e.appVersion === '0.18.0')!)
    const opened = await openProjectFile(userData, path)
    expect(opened.status).toBe('opened')
    if (opened.status !== 'opened') return
    await saveToPath(userData, requestFrom(opened.project), await videoFacts(video), path, '0.18.0')
    const text = await readFileP(path, 'utf8')
    expect(text).not.toContain('"dotted"')
    const raw = JSON.parse(text) as Project
    const saved = raw.annotations.filter((a) => 'style' in a && 'dots' in a.style)
    expect(saved).toHaveLength(1)
    expect(saved[0].style).toMatchObject({ dash: 'dashed', dots: true })
    // Заново прочитанный файл — те же рисунки, что в памяти.
    const again = parseProjectText(text)
    expect(again.ok && again.project.annotations).toEqual(parsed.project.annotations)
  })

  it('«dotted» в файле, записанном ранними сборками 0.18, по-прежнему читается', async () => {
    const raw = JSON.parse(await readFileP(join(DIR, 'v0.18.0.flowproj'), 'utf8')) as Project
    for (const a of raw.annotations) {
      const st = (a as { style?: { dots?: boolean; dash?: string } }).style
      if (st?.dots) {
        delete st.dots
        st.dash = 'dotted'
      }
    }
    const parsed = parseProjectText(JSON.stringify(raw))
    expect(parsed.ok && parsed.project.annotations.some((a) => dashOf(a) === 'dotted')).toBe(true)
  })
})
