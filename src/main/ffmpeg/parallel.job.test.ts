// Параллельный экспорт кусками и выбор кодера на настоящем ffmpeg (этап 18): кадры на стыках, откат с видеокарты,
// отмена, видео с переменной частотой кадров. Остальные проверки экспорта (рисунки, стоп-кадры, звук, лупа, анимация)
// прогоняются в режимах «куски» и «видеокарта» в своих файлах — см. MODES в ffmpeg.testkit.ts.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Timing } from '../../shared/annotations'
import type { ExportRequest } from '../../shared/export'
import { runExportJob, type JobInput, type JobOutput } from './job'
import {
  FFMPEG,
  FIXTURE,
  HAS_GPU,
  boxPng,
  countFrames,
  durationOf,
  ff,
  firstLoudSample,
  frameDistance,
  makeBeepVideo,
  makeLongVideo,
  streamDurations
} from './ffmpeg.testkit'
import { disposeStaged, stageOverlays, type Staged } from './staging'

const CFR25 = FIXTURE('cfr25.mp4')
let work: string
let beep: string
let longVideo: string

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-parallel-test-'))
  beep = makeBeepVideo(work, { seconds: 12, beepAt: 5 })
  longVideo = makeLongVideo(work, 40)
}, 120_000)
afterAll(() => rmSync(work, { recursive: true, force: true }))

let counter = 0
const outDir = (name: string): string => {
  counter += 1
  const dir = join(work, `${name}-${counter}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function request(partial: Partial<ExportRequest>): ExportRequest {
  return {
    videoId: 'x',
    clips: [{ start: 1, end: 3, label: 'Гол' }],
    mode: 'files',
    precision: 'precise',
    padding: 0,
    projectName: null,
    encoder: 'cpu',
    ...partial
  }
}

const run = (
  input: Partial<JobInput> & Pick<JobInput, 'inputPath' | 'request' | 'target'>
): Promise<JobOutput> => runExportJob({ ffmpegPath: FFMPEG, tempRoot: work, ...input })

/** Серые уменьшенные кадры всего файла (или их части): по одному вызову ffmpeg. */
function grayFrames(path: string, from = 0, count?: number): Buffer[] {
  const w = 80
  const h = 45
  const { stdout } = ff(['-i', path, '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'])
  const size = w * h
  const all: Buffer[] = []
  for (let i = 0; i + size <= stdout.length; i += size) all.push(stdout.subarray(i, i + size))
  return all.slice(from, count === undefined ? undefined : from + count)
}

/** Номер кадра исходника, на который больше всего похож кадр (среди всех кадров исходника). */
function matchFrames(source: Buffer[], clip: Buffer[]): number[] {
  return clip.map((frame) => {
    let best = -1
    let bestD = Infinity
    source.forEach((s, i) => {
      const d = frameDistance(frame, s)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  })
}

describe('куски: кадры на стыках', () => {
  const sourceFrames = grayFrames(CFR25)

  it('клип [0.5, 3.5) кусками по 1 с: кадр n результата — кадр 13 + n исходника, ничего не дважды и не пропущено', async () => {
    const dir = outDir('joins')
    const { result, paths } = await run({
      inputPath: CFR25,
      request: request({ clips: [{ start: 0.5, end: 3.5, label: 'Кусками' }] }),
      target: dir,
      tuning: { chunkSeconds: 1, workers: 3 }
    })
    expect(result.status).toBe('done')
    const out = grayFrames(paths[0])
    expect(out).toHaveLength(75)
    expect(countFrames(paths[0])).toBe(75)
    const matched = matchFrames(sourceFrames, out)
    // Кадры исходника: 13 (первый кадр, начало которого не раньше 0.5 с) … 87. Номер нарисован на кадре, соседние кадры различаются.
    expect(matched).toEqual(Array.from({ length: 75 }, (_, n) => 13 + n))
  }, 120_000)

  it('кусками и одним процессом получается один и тот же набор кадров', async () => {
    const a = await run({
      inputPath: CFR25,
      request: request({ clips: [{ start: 0.7, end: 3.3, label: 'А' }] }),
      target: outDir('same-a'),
      tuning: { chunkSeconds: 1 }
    })
    const b = await run({
      inputPath: CFR25,
      request: request({ clips: [{ start: 0.7, end: 3.3, label: 'Б' }] }),
      target: outDir('same-b'),
      tuning: { noChunks: true }
    })
    const fa = matchFrames(sourceFrames, grayFrames(a.paths[0]))
    const fb = matchFrames(sourceFrames, grayFrames(b.paths[0]))
    expect(fa).toEqual(fb)
    expect(fa.length).toBe(65)
  }, 120_000)

  it('подборка из трёх эпизодов кусками: порядок и кадры', async () => {
    const dir = outDir('compilation')
    const target = join(dir, 'c.mp4')
    const clips = [
      { start: 2, end: 3, label: 'А' },
      { start: 0, end: 1, label: 'Б' },
      { start: 3.2, end: 3.9, label: 'В' }
    ]
    const { result } = await run({
      inputPath: CFR25,
      request: request({ clips, mode: 'compilation' }),
      target,
      tuning: { chunkSeconds: 1 }
    })
    expect(result.status).toBe('done')
    const matched = matchFrames(sourceFrames, grayFrames(target))
    // Эпизоды идут по времени в видео: 0–1, 2–3, 3.2–3.9.
    expect(matched).toEqual([
      ...Array.from({ length: 25 }, (_, i) => i),
      ...Array.from({ length: 25 }, (_, i) => 50 + i),
      ...Array.from({ length: 18 }, (_, i) => 80 + i)
    ])
  }, 120_000)

  it('стоп-кадр и рисунки на стыках кусков: счёт кадров как у одного процесса', async () => {
    const W = 640
    const H = 360
    const res = await stageOverlays(
      {
        width: W,
        height: H,
        images: [
          {
            key: '0',
            data: boxPng(W, H, { x0: 20, y0: 60, x1: 90, y1: 120 }, [255, 255, 255]),
            layer: 'over'
          },
          {
            key: '1',
            data: boxPng(W, H, { x0: 20, y0: 60, x1: 90, y1: 120 }, [0, 0, 0]),
            layer: 'over'
          }
        ]
      },
      work
    )
    if (!res.ok) throw new Error(res.error)
    const staged: Staged = res.staged
    try {
      const timings: Timing[] = [
        { mode: 'range', start: 1.2, duration: 0.5 },
        { mode: 'frame', start: 2.02, freezeSeconds: 1 }
      ]
      const drawings = {
        token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
        fps: 25,
        timings,
        loupes: []
      }
      const counts: number[] = []
      for (const tuning of [
        { chunkSeconds: 1 },
        { chunkSeconds: 0.6, workers: 4 },
        { noChunks: true }
      ]) {
        const { result, paths } = await run({
          inputPath: CFR25,
          request: request({ clips: [{ start: 1, end: 4, label: 'Рисунки' }], drawings }),
          target: outDir('frz'),
          overlays: staged,
          tuning
        })
        expect(result.status).toBe('done')
        counts.push(countFrames(paths[0]))
      }
      // 3 с = 75 кадров + 25 кадров стоп-кадра.
      expect(counts).toEqual([100, 100, 100])
    } finally {
      await disposeStaged(staged)
    }
  }, 180_000)
})

describe('куски: звук и длительность', () => {
  it('писк через 5 с от начала клипа попадает в нужное место (±40 мс) и звук с видео одной длины', async () => {
    const dir = outDir('beep')
    const { result, paths } = await run({
      inputPath: beep,
      request: request({ clips: [{ start: 2, end: 9, label: 'Звук' }] }),
      target: dir,
      tuning: { chunkSeconds: 1.2, workers: 3 }
    })
    expect(result.status).toBe('done')
    const at = firstLoudSample(paths[0]) as number
    expect(Math.abs(at - 3)).toBeLessThanOrEqual(0.04)
    const d = streamDurations(paths[0])
    expect(Math.abs(d.video - 7)).toBeLessThanOrEqual(0.08)
    expect(Math.abs(d.audio - 7)).toBeLessThanOrEqual(0.08)
    expect(Math.abs(d.video - d.audio)).toBeLessThanOrEqual(0.08)
    expect(Math.abs((durationOf(paths[0]) as number) - 7)).toBeLessThanOrEqual(0.1)
  }, 120_000)
})

describe('выбор кодера и откат', () => {
  it('сломанная видеокарта: экспорт одним процессом заканчивается на процессоре, кадры на месте', async () => {
    const logs: string[] = []
    const { result, paths } = await run({
      inputPath: CFR25,
      request: request({ encoder: 'auto' }),
      target: outDir('fb-mono'),
      tuning: { fakeBrokenGpu: true, noChunks: true },
      log: (m) => logs.push(m)
    })
    expect(result.status).toBe('done')
    expect(result.failures).toEqual([])
    expect(countFrames(paths[0])).toBe(50)
    expect(logs.some((l) => l.includes('не сработал'))).toBe(true)
  }, 60_000)

  it('сломанная видеокарта: экспорт кусками заканчивается на процессоре, кадры на месте', async () => {
    const logs: string[] = []
    const { result, paths } = await run({
      inputPath: CFR25,
      request: request({ encoder: 'auto', clips: [{ start: 0, end: 4, label: 'Откат' }] }),
      target: outDir('fb-chunks'),
      tuning: { fakeBrokenGpu: true, chunkSeconds: 1 },
      log: (m) => logs.push(m)
    })
    expect(result.status).toBe('done')
    expect(countFrames(paths[0])).toBe(100)
    expect(logs.some((l) => l.includes('на процессоре'))).toBe(true)
  }, 60_000)

  it('сломанная видеокарта, несколько файлов: первый откатывается, остальные сразу идут на процессоре', async () => {
    const logs: string[] = []
    const { result, paths } = await run({
      inputPath: CFR25,
      request: request({
        encoder: 'auto',
        clips: [
          { start: 0, end: 1, label: 'А' },
          { start: 2, end: 3, label: 'Б' }
        ]
      }),
      target: outDir('fb-files'),
      tuning: { fakeBrokenGpu: true },
      log: (m) => logs.push(m)
    })
    expect(result.status).toBe('done')
    expect(paths).toHaveLength(2)
    expect(logs.filter((l) => l.includes('не сработал'))).toHaveLength(1)
  }, 60_000)

  it('«Процессор»: видеокарта даже не проверяется', async () => {
    const logs: string[] = []
    const { result } = await run({
      inputPath: CFR25,
      request: request({ encoder: 'cpu' }),
      target: outDir('cpu-only'),
      tuning: { fakeBrokenGpu: true },
      log: (m) => logs.push(m)
    })
    expect(result.status).toBe('done')
    expect(logs.some((l) => l.includes('libx264'))).toBe(true)
    expect(logs.some((l) => l.includes('не сработал'))).toBe(false)
  }, 60_000)

  it('«Авто»: на этом компьютере видеокарта работает (если она есть)', async () => {
    if (!HAS_GPU) return
    const logs: string[] = []
    const { result, paths } = await run({
      inputPath: CFR25,
      request: request({ encoder: 'auto' }),
      target: outDir('gpu'),
      log: (m) => logs.push(m)
    })
    expect(result.status).toBe('done')
    expect(countFrames(paths[0])).toBe(50)
    expect(logs.some((l) => /h264_(nvenc|qsv|amf)/.test(l))).toBe(true)
  }, 60_000)
})

describe('куски: отмена и уборка', () => {
  it('отмена посреди параллельного экспорта: процессы остановлены, временных папок и недописанных файлов нет', async () => {
    const dir = outDir('cancel')
    const controller = new AbortController()
    const temp = outDir('cancel-temp')
    const started = Date.now()
    setTimeout(() => controller.abort(), 2500)
    const { result } = await run({
      inputPath: longVideo,
      request: request({ clips: [{ start: 0, end: 38, label: 'Долгий' }] }),
      target: dir,
      signal: controller.signal,
      tempRoot: temp,
      tuning: { chunkSeconds: 2, workers: 3 }
    })
    expect(result.status).toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(30_000)
    expect(readdirSync(dir)).toEqual([])
    expect(readdirSync(temp)).toEqual([])
  }, 90_000)

  it('ошибка в одном куске: понятное сообщение, временные папки убраны', async () => {
    const dir = outDir('error')
    const temp = outDir('error-temp')
    const { result } = await run({
      inputPath: FIXTURE('broken.mp4'),
      request: request({ clips: [{ start: 0, end: 1, label: 'Битый' }] }),
      target: dir,
      tempRoot: temp,
      tuning: { chunkSeconds: 1 }
    }).catch((e: Error) => ({ result: { status: 'error', message: e.message } }))
    expect(['failed', 'error']).toContain(result.status)
    expect(existsSync(temp) ? readdirSync(temp) : []).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  }, 60_000)
})

describe('видео с переменной частотой кадров', () => {
  it('куски не включаются (кадры считались бы по ровной сетке): экспорт идёт одним процессом и получается', async () => {
    const vfr = join(work, 'vfr.mp4')
    const r = ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=30:duration=8',
      '-vf',
      "select='gte(random(0)\\,0.3)'",
      '-fps_mode',
      'passthrough',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-y',
      vfr
    ])
    expect(r.status).toBe(0)
    const logs: string[] = []
    const { result, paths } = await run({
      inputPath: vfr,
      request: request({ clips: [{ start: 1, end: 3, label: 'ПЧК' }] }),
      target: outDir('vfr'),
      tuning: { chunkSeconds: 1 },
      log: (m) => logs.push(m)
    })
    expect(result.status).toBe('done')
    expect(countFrames(paths[0])).toBeGreaterThan(10)
    expect(logs.some((l) => l.includes('кусками'))).toBe(false)
  }, 60_000)
})
