// Тесты с настоящим ffmpeg: точность вырезания, подборка, отмена, ошибки. Медленнее обычных, но укладываются в десяток секунд.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ExportProgress, ExportRequest } from '../../shared/export'
import { COMPILATION_FAST_ERROR, ExportError, runExportJob, type JobOutput } from './job'
import { EXPORT_MESSAGES } from './progress'
import {
  FFMPEG,
  FIXTURE,
  closestSourceFrame,
  countFrames,
  durationOf,
  firstLoudSample,
  frameDistance,
  grayFrame,
  hasAudio,
  makeAudioVideo,
  makeBeepVideo,
  makeLongVideo,
  streamDurations
} from './ffmpeg.testkit'

const CFR25 = FIXTURE('cfr25.mp4')
let work: string
let withAudio: string
let longVideo: string

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-job-test-'))
  withAudio = makeAudioVideo(work)
  longVideo = makeLongVideo(work, 40)
}, 60_000)

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

const outDir = (name: string): string => {
  const dir = join(work, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function request(partial: Partial<ExportRequest>): ExportRequest {
  return {
    videoId: 'x',
    clips: [{ start: 1, end: 2, label: 'Гол' }],
    mode: 'files',
    precision: 'precise',
    padding: 0,
    projectName: null,
    ...partial
  }
}

const run = (
  input: string,
  req: ExportRequest,
  target: string,
  extra: { signal?: AbortSignal; onProgress?: (p: ExportProgress) => void } = {}
): Promise<JobOutput> =>
  runExportJob({ ffmpegPath: FFMPEG, inputPath: input, request: req, target, ...extra })

describe('вырезание клипов (ffmpeg)', () => {
  it('точный режим [1.0, 2.0] из cfr25: ровно 25 кадров, первый — кадр 25', async () => {
    const dir = outDir('precise')
    const { result, paths } = await run(CFR25, request({}), dir)
    expect(result.status).toBe('done')
    expect(result.files).toEqual(['001_Гол_00-01.mp4'])
    expect(result.failures).toEqual([])
    expect(readdirSync(dir)).toEqual(['001_Гол_00-01.mp4'])

    const out = paths[0]
    expect(countFrames(out)).toBe(25)
    expect(durationOf(out)).toBeCloseTo(1.0, 1)
    // На кадре видео нарисован его номер: первый кадр клипа должен быть самым похожим на кадр 25 исходника.
    expect(closestSourceFrame(CFR25, out, [23, 24, 25, 26, 27])).toBe(25)
  }, 30_000)

  it('точный режим с нецелым началом: [0.52, 1.32] = 20 кадров, первый — кадр 13', async () => {
    const dir = outDir('precise-frac')
    const { paths } = await run(
      CFR25,
      request({ clips: [{ start: 0.52, end: 1.32, label: 'x' }] }),
      dir
    )
    expect(countFrames(paths[0])).toBe(20)
    expect(closestSourceFrame(CFR25, paths[0], [11, 12, 13, 14, 15])).toBe(13)
  }, 30_000)

  it('граница посередине между кадрами: [2.5, 3.5] = 25 кадров, [0.5, 2.5] = 50', async () => {
    const dir = outDir('half-frame')
    const a = await run(CFR25, request({ clips: [{ start: 2.5, end: 3.5, label: 'a' }] }), dir)
    expect(countFrames(a.paths[0])).toBe(25)
    const b = await run(CFR25, request({ clips: [{ start: 0.5, end: 2.5, label: 'b' }] }), dir)
    expect(countFrames(b.paths[0])).toBe(50)
  }, 30_000)

  it('быстрый режим создаёт файл (границы по ключевым кадрам)', async () => {
    const dir = outDir('fast')
    const { result, paths } = await run(CFR25, request({ precision: 'fast' }), dir)
    expect(result.status).toBe('done')
    expect(countFrames(paths[0])).toBeGreaterThan(0)
    expect(durationOf(paths[0])).toBeGreaterThan(0.5)
  }, 30_000)

  it('несколько клипов в папку: имена по порядку, существующие файлы не затираются', async () => {
    const dir = outDir('many')
    writeFileSync(join(dir, '002_Пас_00-02.mp4'), 'старый файл')
    const req = request({
      clips: [
        { start: 2, end: 3, label: 'Пас' },
        { start: 0.4, end: 1.2, label: 'Гол' }
      ]
    })
    const { result } = await run(CFR25, req, dir)
    expect(result.files).toEqual(['001_Гол_00-00.mp4', '002_Пас_00-02 (2).mp4'])
    expect(readdirSync(dir).sort()).toEqual(
      ['001_Гол_00-00.mp4', '002_Пас_00-02 (2).mp4', '002_Пас_00-02.mp4'].sort()
    )

    // Повторный экспорт: ничего не перезаписывается, добавляется « (2)».
    const again = await run(CFR25, req, dir)
    expect(again.result.files).toEqual(['001_Гол_00-00 (2).mp4', '002_Пас_00-02 (3).mp4'])
  }, 30_000)

  it('запас по краям: [1.0, 2.0] с запасом 0.52 = [0.48, 2.52] (51 кадр)', async () => {
    const dir = outDir('padding')
    const { paths } = await run(CFR25, request({ padding: 0.52 }), dir)
    expect(countFrames(paths[0])).toBe(51)
  }, 30_000)

  it('запас обрезается границами видео: начало 0.2 с запасом 1 → с нуля', async () => {
    const dir = outDir('padding-clamp')
    const { paths } = await run(
      CFR25,
      request({ clips: [{ start: 0.2, end: 1.0, label: 'a' }], padding: 1 }),
      dir
    )
    // 0 .. 2.0 с = 50 кадров
    expect(countFrames(paths[0])).toBe(50)
  }, 30_000)
})

describe('подборка (ffmpeg)', () => {
  it('[0.5, 1.0] + [2.0, 3.0] без звука ≈ 1.5 с (37–38 кадров), звука нет', async () => {
    const dir = outDir('comp')
    const target = join(dir, 'подборка.mp4')
    const req = request({
      mode: 'compilation',
      clips: [
        { start: 2, end: 3, label: 'б' },
        { start: 0.5, end: 1, label: 'а' }
      ]
    })
    const { result, paths } = await run(CFR25, req, target)
    expect(result.status).toBe('done')
    expect(paths).toEqual([target])
    expect(readdirSync(dir)).toEqual(['подборка.mp4'])
    const frames = countFrames(target)
    expect(frames).toBeGreaterThanOrEqual(37)
    expect(frames).toBeLessThanOrEqual(38)
    expect(durationOf(target)).toBeGreaterThan(1.4)
    expect(durationOf(target)).toBeLessThan(1.6)
    expect(hasAudio(target)).toBe(false)
    // Порядок хронологический: первый кадр подборки — кадр 12/13 (0.5 с), не кадр 50 (2.0 с).
    expect(closestSourceFrame(CFR25, target, [12, 13, 50])).toBeLessThan(14)
  }, 30_000)

  it('со звуком: звуковая дорожка сохраняется, длительность ≈ сумме', async () => {
    const dir = outDir('comp-audio')
    const target = join(dir, 'a.mp4')
    const req = request({
      mode: 'compilation',
      clips: [
        { start: 1, end: 2, label: 'а' },
        { start: 4, end: 5.5, label: 'б' }
      ]
    })
    const { result } = await run(withAudio, req, target)
    expect(result.status).toBe('done')
    expect(hasAudio(target)).toBe(true)
    const d = durationOf(target) ?? 0
    expect(d).toBeGreaterThan(2.4)
    expect(d).toBeLessThan(2.7)
  }, 30_000)

  it('далёкие эпизоды (разные входы с быстрой перемоткой): кадры и их порядок точные', async () => {
    const dir = outDir('comp-far')
    const target = join(dir, 'far.mp4')
    const req = request({
      mode: 'compilation',
      clips: [
        { start: 30, end: 32, label: 'б' },
        { start: 1, end: 3, label: 'а' }
      ]
    })
    const { result } = await run(longVideo, req, target)
    expect(result.status).toBe('done')
    const frames = countFrames(target)
    expect(frames).toBeGreaterThanOrEqual(119)
    expect(frames).toBeLessThanOrEqual(121)
    // longVideo — 30 к/с: первый кадр подборки — кадр 30 (1.0 с), кадр №60 подборки — кадр 900 (30.0 с).
    expect(closestSourceFrame(longVideo, target, [29, 30, 31, 900])).toBeGreaterThanOrEqual(29)
    expect(closestSourceFrame(longVideo, target, [29, 30, 31, 900])).toBeLessThanOrEqual(31)
    const second = grayFrame(target, 60)
    const best = [899, 900, 901, 30].sort(
      (a, b) =>
        frameDistance(second, grayFrame(longVideo, a)) -
        frameDistance(second, grayFrame(longVideo, b))
    )[0]
    expect([899, 900, 901]).toContain(best)
  }, 60_000)

  it('далёкие эпизоды со звуком: звук не уезжает от картинки (писк на нужной секунде)', async () => {
    const dir = outDir('comp-far-audio')
    const source = makeBeepVideo(dir, { seconds: 40, beepAt: 31 })
    const target = join(dir, 'out.mp4')
    const req = request({
      mode: 'compilation',
      clips: [
        { start: 1, end: 3, label: 'а' },
        { start: 30, end: 32, label: 'б' }
      ]
    })
    const { result } = await run(source, req, target)
    expect(result.status).toBe('done')
    // Первый кусок — 2 с, во втором писк на 1-й секунде от его начала: ждём писк на 3.0 с.
    const beepAt = firstLoudSample(target) as number
    expect(Math.abs(beepAt - 3)).toBeLessThanOrEqual(0.05)
    const d = streamDurations(target)
    expect(Math.abs(d.video - d.audio)).toBeLessThan(0.1)
    expect(Math.abs(d.video - 4)).toBeLessThan(0.15)
  }, 60_000)

  it('«Быстро» для подборки отклоняется понятным сообщением', async () => {
    const dir = outDir('comp-fast')
    const req = request({ mode: 'compilation', precision: 'fast' })
    await expect(run(CFR25, req, join(dir, 'a.mp4'))).rejects.toThrow(COMPILATION_FAST_ERROR)
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('отмена и ошибки (ffmpeg)', () => {
  it('отмена посреди клипа убирает недописанный файл', async () => {
    const dir = outDir('cancel')
    const controller = new AbortController()
    let sawProgress = false
    const req = request({ clips: [{ start: 0, end: 39, label: 'длинный' }] })
    const { result, paths } = await run(longVideo, req, dir, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.clipFraction > 0.02 && !sawProgress) {
          sawProgress = true
          controller.abort()
        }
      }
    })
    expect(sawProgress).toBe(true)
    expect(result.status).toBe('cancelled')
    expect(paths).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  }, 60_000)

  it('отмена подборки убирает недописанный файл и временные файлы', async () => {
    const dir = outDir('cancel-comp')
    const controller = new AbortController()
    const temp = outDir('cancel-comp-tmp')
    const req = request({
      mode: 'compilation',
      clips: [
        { start: 0, end: 20, label: 'а' },
        { start: 22, end: 39, label: 'б' }
      ]
    })
    const target = join(dir, 'c.mp4')
    const { result } = await runExportJob({
      ffmpegPath: FFMPEG,
      inputPath: longVideo,
      request: req,
      target,
      tempRoot: temp,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.overallFraction > 0.02) controller.abort()
      }
    })
    expect(result.status).toBe('cancelled')
    expect(readdirSync(dir)).toEqual([])
    expect(readdirSync(temp)).toEqual([])
  }, 60_000)

  it('в режиме отдельных файлов отмена оставляет уже готовые клипы', async () => {
    const dir = outDir('cancel-keep')
    const controller = new AbortController()
    const req = request({
      clips: [
        { start: 0, end: 1, label: 'первый' },
        { start: 2, end: 39, label: 'второй' }
      ]
    })
    const { result } = await run(longVideo, req, dir, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.index === 1 && p.clipFraction > 0.02) controller.abort()
      }
    })
    expect(result.status).toBe('cancelled')
    expect(result.files).toEqual(['001_первый_00-00.mp4'])
    expect(readdirSync(dir)).toEqual(['001_первый_00-00.mp4'])
  }, 60_000)

  it('повреждённый файл: понятное сообщение, ничего не создано', async () => {
    const dir = outDir('broken')
    const error = await run(FIXTURE('broken.mp4'), request({}), dir).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExportError)
    expect((error as Error).message).toBe(EXPORT_MESSAGES.badInput)
    expect(readdirSync(dir)).toEqual([])
  })

  it('эпизод за пределами видео отклоняется', async () => {
    const dir = outDir('outside')
    const req = request({ clips: [{ start: 10, end: 11, label: 'a' }] })
    await expect(run(CFR25, req, dir)).rejects.toThrow('за пределы видео')
  })

  it('недоступная папка: сообщение об ошибке для клипа, остальное не ломается', async () => {
    const missing = join(work, 'нет-такой-папки')
    const { result } = await run(CFR25, request({}), missing)
    expect(result.status).toBe('failed')
    expect(result.files).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].message).toBeTruthy()
    expect(result.failures[0].details).toBeTruthy()
  }, 30_000)

  it('несуществующий ffmpeg: процесс не запускается — ошибка, а не падение', async () => {
    const dir = outDir('nofF')
    const out = await runExportJob({
      ffmpegPath: join(work, 'нет-ffmpeg.exe'),
      inputPath: CFR25,
      request: request({}),
      target: dir
    }).catch((e: unknown) => e)
    expect(out).toBeInstanceOf(ExportError)
  })
})

describe('прогресс', () => {
  it('идёт от 0 к 1 по возрастанию', async () => {
    const dir = outDir('progress')
    const seen: ExportProgress[] = []
    await run(
      CFR25,
      request({
        clips: [
          { start: 0, end: 2, label: 'a' },
          { start: 2, end: 4, label: 'b' }
        ]
      }),
      dir,
      {
        onProgress: (p) => seen.push(p)
      }
    )
    expect(seen.length).toBeGreaterThan(2)
    expect(seen[0].overallFraction).toBe(0)
    expect(seen[seen.length - 1].overallFraction).toBeCloseTo(1, 1)
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].overallFraction).toBeGreaterThanOrEqual(seen[i - 1].overallFraction - 1e-9)
    }
    expect(new Set(seen.map((p) => p.index))).toEqual(new Set([0, 1]))
    expect(seen.every((p) => p.count === 2)).toBe(true)
  }, 30_000)
})
