// Тесты экспорта с рисунками на настоящем ffmpeg: наложение в нужные кадры, стоп-кадры, звук, пути с кириллицей.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, beforeEach } from 'vitest'
import type { Timing } from '../../shared/annotations'
import type { ExportProgress, ExportRequest } from '../../shared/export'
import { type JobOutput } from './job'
import {
  FFMPEG,
  FIXTURE,
  boxPng,
  closestSourceFrame,
  countFrames,
  durationOf,
  firstLoudSample,
  frameDistance,
  grayFrame,
  hasAudio,
  isBlack,
  isWhite,
  makeAudioVideo,
  makeBeepVideo,
  pixelAt,
  frameRgb,
  framesWhere,
  streamDurations,
  MODES,
  runJob,
  setTestMode
} from './ffmpeg.testkit'
import { disposeStaged, liveCount, stageOverlays, type Staged } from './staging'

const CFR25 = FIXTURE('cfr25.mp4')
const W = 640
const H = 360
let work: string
/** Папка с кириллицей и пробелом в имени: так проверяются пути в аргументах ffmpeg. */
let cyr: string

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-drawn-test-'))
  cyr = join(work, 'папка с пробелом')
  mkdirSync(cyr)
}, 60_000)

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

/** Картинки каждого теста убираются после него, даже если проверка упала. */
const stagedNow: Staged[] = []
afterEach(async () => {
  for (const s of stagedNow.splice(0)) await disposeStaged(s)
})

const range = (start: number, duration: number): Timing => ({ mode: 'range', start, duration })
const frameAt = (start: number, freezeSeconds: number): Timing => ({
  mode: 'frame',
  start,
  freezeSeconds
})

const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]
/** Точка внутри обоих прямоугольников. */
const PX = 50
const PY = 90
const BOX = { x0: 20, y0: 60, x1: 90, y1: 120 }

async function stage(
  images: Array<{ key: string; rgb: [number, number, number] }>,
  width = W,
  height = H,
  root = cyr
): Promise<Staged> {
  const res = await stageOverlays(
    {
      width,
      height,
      images: images.map((i) => ({ key: i.key, data: boxPng(width, height, BOX, i.rgb) }))
    },
    root
  )
  if (!res.ok) throw new Error(res.error)
  stagedNow.push(res.staged)
  return res.staged
}

function request(partial: Partial<ExportRequest>, timings: Timing[], fps = 25): ExportRequest {
  return {
    videoId: 'x',
    clips: [{ start: 1, end: 3, label: 'Гол' }],
    mode: 'files',
    precision: 'precise',
    padding: 0,
    projectName: null,
    drawings: { token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11', fps, timings, loupes: [] },
    ...partial
  }
}

let counter = 0
const outDir = (name: string): string => {
  counter += 1
  const dir = join(cyr, `${name}-${counter}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

async function run(
  input: string,
  req: ExportRequest,
  staged: Staged | undefined,
  target: string,
  extra: { signal?: AbortSignal; onProgress?: (p: ExportProgress) => void; tempRoot?: string } = {}
): Promise<JobOutput> {
  return runJob({
    ffmpegPath: FFMPEG,
    inputPath: input,
    request: req,
    target,
    overlays: staged,
    tempRoot: cyr,
    ...extra
  })
}

describe.each(MODES)('экспорт с рисунками (ffmpeg) [$name]', (mode) => {
  beforeEach(() => setTestMode(mode))
  it('наложение по времени, стоп-кадр с рисунком, длительность, пути с кириллицей', async () => {
    // Рисунок-отрезок 1.5–2.0 (красный) и рисунок «только кадр» на кадре 50 (зелёный), стоп-кадр 1.5 с.
    const timings = [range(1.5, 0.5), frameAt(2.02, 1.5)]
    const staged = await stage([
      { key: '0', rgb: WHITE },
      { key: '1', rgb: BLACK }
    ])
    const dir = outDir('basic')
    const progress: ExportProgress[] = []
    const { result, paths } = await run(CFR25, request({}, timings), staged, dir, {
      onProgress: (p) => progress.push(p)
    })
    expect(result.failures).toEqual([])
    expect(result.status).toBe('done')
    const out = paths[0]

    // 2.0 с обычного видео + 1.5 с стоп-кадра = 3.5 с = 87.5 кадра (допуск в один кадр); длительность контейнера чуть больше.
    expect(Math.abs(countFrames(out) - 87.5)).toBeLessThanOrEqual(1)
    expect(Math.abs((durationOf(out) as number) - 3.5)).toBeLessThanOrEqual(0.08)

    // Белый (рисунок-отрезок): кадры исходника 37..49 → кадры результата 12..24 (±1 кадр на границах).
    const white = framesWhere(out, PX, PY, isWhite)
    const firstFreeze = 25
    const whiteInNormal = white.filter((i) => i < firstFreeze)
    expect(whiteInNormal[0]).toBeGreaterThanOrEqual(11)
    expect(whiteInNormal[0]).toBeLessThanOrEqual(13)
    expect(whiteInNormal[whiteInNormal.length - 1]).toBeGreaterThanOrEqual(23)
    expect(whiteInNormal[whiteInNormal.length - 1]).toBeLessThanOrEqual(25)
    // Белого нет ни до, ни после отрезка (и на стоп-кадре, и после него).
    expect(white.filter((i) => i < 11 || i > 25)).toEqual([])
    // Подряд, без дыр.
    expect(whiteInNormal.length).toBeGreaterThanOrEqual(12)
    // Чёрный (рисунок «только кадр») — ровно на стоп-кадре, ±1 кадр: 25..62.
    const black = framesWhere(out, PX, PY, isBlack)
    expect(black[0]).toBeGreaterThanOrEqual(24)
    expect(black[0]).toBeLessThanOrEqual(26)
    expect(black[black.length - 1]).toBeGreaterThanOrEqual(61)
    expect(black[black.length - 1]).toBeLessThanOrEqual(63)
    expect(black.length).toBeGreaterThanOrEqual(36)

    // Стоп-кадр: на нём чёрный, кадры одинаковые и совпадают с кадром 50 исходника.
    const mid = frameRgb(out, 40, W, H)
    expect(isBlack(pixelAt(mid, W, PX, PY))).toBe(true)
    expect(frameDistance(grayFrame(out, 30), grayFrame(out, 60))).toBeLessThan(1)
    expect(closestSourceFrame(CFR25, out, [48, 49, 50, 51, 52])).not.toBe(-1)
    // Первый кадр стоп-кадра — кадр 50 исходника.
    const freezeStart = grayFrame(out, 28)
    let best = -1
    let bestD = Infinity
    for (const n of [48, 49, 50, 51, 52]) {
      const d = frameDistance(freezeStart, grayFrame(CFR25, n))
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    expect(best).toBe(50)

    // Прогресс дошёл до конца и не вышел за 1.
    expect(progress.length).toBeGreaterThan(0)
    expect(Math.max(...progress.map((p) => p.overallFraction))).toBeLessThanOrEqual(1)
    expect(progress[progress.length - 1].overallFraction).toBe(1)

    // Временные файлы графа убраны, картинки убирает владелец (здесь — тест).
    expect(readdirSync(cyr).filter((n) => n.startsWith('flow-export-'))).toEqual([])
    await disposeStaged(staged)
  }, 60_000)

  it('кадров после стоп-кадра столько же, сколько в исходнике (ничего не потеряно)', async () => {
    const timings = [frameAt(2.02, 1)]
    const staged = await stage([{ key: '0', rgb: BLACK }])
    const { paths } = await run(CFR25, request({}, timings), staged, outDir('count'))
    // 50 кадров исходника [1, 3) + 25 кадров стоп-кадра (±1).
    const frames = countFrames(paths[0])
    expect(Math.abs(frames - 75)).toBeLessThanOrEqual(1)
    await disposeStaged(staged)
  }, 60_000)

  it('стоп-кадры на краях и подряд: пустые куски не ломают склейку, кадры не теряются', async () => {
    const staged = await stage([
      { key: '0', rgb: BLACK },
      { key: '1', rgb: BLACK },
      { key: '0-1', rgb: BLACK }
    ])
    const check = async (
      name: string,
      timings: Timing[],
      clip: { start: number; end: number },
      expectedFrames: number
    ): Promise<string> => {
      const { paths, result } = await run(
        CFR25,
        request({ clips: [{ ...clip, label: name }] }, timings),
        staged,
        outDir(name)
      )
      expect(result.failures, name).toEqual([])
      expect(result.status, name).toBe('done')
      expect(countFrames(paths[0]), name).toBe(expectedFrames)
      return paths[0]
    }
    // Первый кадр отрезка (кадр 25): стоп-кадр в самом начале, дальше кадры 26..74.
    const first = await check('first', [frameAt(1.02, 1)], { start: 1, end: 3 }, 26 + 49)
    expect(framesWhere(first, PX, PY, isBlack)[0]).toBe(0)
    // Последний кадр отрезка (кадр 74).
    const last = await check('last', [frameAt(2.98, 1)], { start: 1, end: 3 }, 49 + 26)
    const lastBlack = framesWhere(last, PX, PY, isBlack)
    expect(lastBlack[lastBlack.length - 1]).toBe(74)
    // Два стоп-кадра на соседних кадрах (между ними куска нет).
    await check(
      'adjacent',
      [frameAt(2.02, 1), frameAt(2.06, 1)],
      { start: 1, end: 3 },
      25 + 26 + 26 + 23
    )
    // Начало отрезка внутри кадра: кадр 25 в отрезок не входит, стоп-кадр на кадре 26 первый.
    await check('unaligned', [frameAt(1.06, 1)], { start: 1.01, end: 3 }, 26 + 48)
    // Несколько рисунков на одном кадре: один стоп-кадр, длина — наибольшая.
    await check(
      'same-frame',
      [frameAt(2.02, 1), frameAt(2.03, 2)],
      { start: 1, end: 3 },
      25 + 51 + 24
    )
  }, 120_000)

  it('между стоп-кадрами 0, 1 и 2 обычных кадра: число кадров точное, промежуточные кадры на месте', async () => {
    const staged = await stage([
      { key: '0', rgb: BLACK },
      { key: '1', rgb: BLACK },
      { key: '0-1', rgb: BLACK }
    ])
    // Кадр k исходника (25 к/с) имеет середину (k + 0.5) / 25; стоп-кадры по 1 с (25 лишних кадров).
    const at = (k: number): number => (k + 0.5) / 25
    const srcGray = new Map<number, Buffer>()
    const src = (k: number): Buffer => {
      if (!srcGray.has(k)) srcGray.set(k, grayFrame(CFR25, k))
      return srcGray.get(k)!
    }
    for (const between of [0, 1, 2]) {
      const second = 50 + between + 1
      const name = `between${between}`
      const { paths, result } = await run(
        CFR25,
        request({}, [frameAt(at(50), 1), frameAt(at(second), 1)]),
        staged,
        outDir(name)
      )
      expect(result.failures, name).toEqual([])
      const out = paths[0]
      // 50 кадров отрезка [1, 3) + 2 × 25.
      expect(countFrames(out), name).toBe(100)
      // Порядок: кадры 25..49, кадр 50 ×26, обычные кадры между ними, кадр `second` ×26, остальные до 74.
      const expected: number[] = []
      for (let k = 25; k < 50; k += 1) expected.push(k)
      for (let i = 0; i < 26; i += 1) expected.push(50)
      for (let k = 51; k < second; k += 1) expected.push(k)
      for (let i = 0; i < 26; i += 1) expected.push(second)
      for (let k = second + 1; k <= 74; k += 1) expected.push(k)
      expect(expected.length, name).toBe(100)
      // Проверяем кадры на границах повторов и сами промежуточные.
      for (let i = 22; i < 99; i += 1) {
        if (expected[i] === expected[i - 1] && expected[i] === expected[i + 1]) continue
        const got = grayFrame(out, i)
        const candidates = [expected[i] - 1, expected[i], expected[i] + 1].filter(
          (k) => k >= 25 && k <= 74
        )
        let best = -1
        let bestD = Infinity
        for (const k of candidates) {
          const d = frameDistance(got, src(k))
          if (d < bestD) {
            bestD = d
            best = k
          }
        }
        expect(best, `${name}: кадр ${i}`).toBe(expected[i])
      }
    }
    await disposeStaged(staged)
  }, 240_000)

  it('между стоп-кадрами 0, 1 и 2 обычных кадра, звук: «писк» после стоп-кадров не сдвигается', async () => {
    const beep = makeBeepVideo(work, { seconds: 10, beepAt: 5 })
    const staged = await stage(
      [
        { key: '0', rgb: BLACK },
        { key: '1', rgb: BLACK },
        { key: '0-1', rgb: BLACK }
      ],
      320,
      180
    )
    const at = (k: number): number => (k + 0.5) / 25
    for (const between of [0, 1, 2]) {
      const { paths, result } = await run(
        beep,
        request({ clips: [{ start: 1, end: 8, label: 'a' }] }, [
          frameAt(at(50), 1),
          frameAt(at(51 + between), 1)
        ]),
        staged,
        outDir(`audio-between${between}`)
      )
      expect(result.failures).toEqual([])
      const out = paths[0]
      const dur = streamDurations(out)
      expect(Math.abs(dur.video - dur.audio), `между ${between}`).toBeLessThanOrEqual(0.04)
      expect(Math.abs(dur.video - 9), `между ${between}`).toBeLessThanOrEqual(0.06)
      // 5 − 1 + 2 с стоп-кадров.
      const beepAt = firstLoudSample(out) as number
      expect(Math.abs(beepAt - 6), `между ${between}`).toBeLessThanOrEqual(0.04)
    }
    await disposeStaged(staged)
  }, 240_000)

  it('одиночный обычный кадр в конце и в начале отрезков подборки (на стыке): кадры и звук на месте', async () => {
    const beep = makeBeepVideo(work, { seconds: 10, beepAt: 5.5 })
    const staged = await stage(
      [
        { key: '0', rgb: BLACK },
        { key: '1', rgb: BLACK }
      ],
      320,
      180
    )
    const at = (k: number): number => (k + 0.5) / 25
    // Отрезки [1, 3) (кадры 25..74) и [5, 7) (кадры 125..174). Стоп-кадр на кадре 73 оставляет в хвосте первого отрезка
    // один кадр 74, стоп-кадр на кадре 126 — один кадр 125 в голове второго.
    const { paths, result } = await run(
      beep,
      request(
        {
          mode: 'compilation',
          clips: [
            { start: 1, end: 3, label: 'a' },
            { start: 5, end: 7, label: 'b' }
          ]
        },
        [frameAt(at(73), 1), frameAt(at(126), 1)]
      ),
      staged,
      join(outDir('junction'), 'подборка.mp4')
    )
    expect(result.failures).toEqual([])
    const out = paths[0]
    expect(countFrames(out)).toBe(100 + 50)
    // Номера кадров результата: 0..47 кадры 25..72, 48..73 кадр 73, 74 кадр 74, 75 кадр 125, 76..101 кадр 126, 102.. кадры 127.
    const probes: Array<[number, number]> = [
      [47, 72],
      [48, 73],
      [73, 73],
      [74, 74],
      [75, 125],
      [76, 126],
      [101, 126],
      [102, 127]
    ]
    // Кадр результата сравнивается с исходником (320x180 с отличимыми номерами кадров) по ближайшему соседу.
    for (const [i, k] of probes) {
      const got = grayFrame(out, i)
      let best = -1
      let bestD = Infinity
      for (const c of [k - 1, k, k + 1]) {
        const d = frameDistance(got, grayFrame(beep, c))
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      expect(best, `кадр ${i}`).toBe(k)
    }
    const dur = streamDurations(out)
    expect(Math.abs(dur.video - dur.audio)).toBeLessThanOrEqual(0.04)
    // «Писк» 5.5 с: 2 + 1 + 0.5 + 1 с стоп-кадра второго отрезка.
    const beepAt = firstLoudSample(out) as number
    expect(Math.abs(beepAt - 4.5)).toBeLessThanOrEqual(0.04)
    await disposeStaged(staged)
  }, 120_000)

  it('рисунок дольше отрезка виден на всех его кадрах, включая первый и последний', async () => {
    const staged = await stage([{ key: '0', rgb: WHITE }])
    const { paths } = await run(CFR25, request({}, [range(0, 10)]), staged, outDir('whole-clip'))
    expect(countFrames(paths[0])).toBe(50)
    const white = framesWhere(paths[0], PX, PY, isWhite)
    expect(white).toHaveLength(50)
    expect(white[0]).toBe(0)
    expect(white[49]).toBe(49)
  }, 60_000)

  it('нет рисунков в отрезке — обычная обрезка без графа', async () => {
    const timings = [range(3.5, 0.3)]
    const staged = await stage([{ key: '0', rgb: WHITE }])
    const { paths, result } = await run(CFR25, request({}, timings), staged, outDir('plain'))
    expect(result.status).toBe('done')
    expect(countFrames(paths[0])).toBe(50)
    expect(framesWhere(paths[0], PX, PY, isWhite)).toEqual([])
    await disposeStaged(staged)
  }, 60_000)

  it('нехватка картинки — понятная ошибка до запуска', async () => {
    const staged = await stage([{ key: '5', rgb: WHITE }])
    await expect(
      run(CFR25, request({}, [range(1.5, 0.5)]), staged, outDir('missing'))
    ).rejects.toThrow(/рисунки/i)
    await disposeStaged(staged)
  }, 60_000)

  it('со звуком: звук и картинка не расходятся после стоп-кадра', async () => {
    const beep = makeBeepVideo(work, { seconds: 10, beepAt: 5 })
    expect(hasAudio(beep)).toBe(true)
    // Отрезок [1, 8): стоп-кадр на кадре 50 (t≈2.02) на 2 с → «писк» (5.0 с в исходнике) сместится на +2 с относительно начала: 5 − 1 + 2 = 6.
    const timings = [frameAt(2.02, 2)]
    const staged = await stage([{ key: '0', rgb: BLACK }], 320, 180)
    const { paths, result } = await run(
      beep,
      request({ clips: [{ start: 1, end: 8, label: 'a' }] }, timings),
      staged,
      outDir('audio')
    )
    expect(result.failures).toEqual([])
    const out = paths[0]
    const dur = streamDurations(out)
    expect(Math.abs(dur.video - dur.audio)).toBeLessThanOrEqual(0.04)
    expect(Math.abs(dur.video - 9)).toBeLessThanOrEqual(0.06)
    const beepAt = firstLoudSample(out) as number
    expect(Math.abs(beepAt - 6)).toBeLessThanOrEqual(0.04)
    await disposeStaged(staged)
  }, 90_000)

  it('моно-звук и несколько стоп-кадров в подборке из двух отрезков', async () => {
    const beep = makeBeepVideo(work, { seconds: 10, beepAt: 7, mono: true })
    const timings = [frameAt(1.02, 1), frameAt(5.02, 0.5), range(6, 1)]
    const staged = await stage(
      [
        { key: '0', rgb: BLACK },
        { key: '1', rgb: BLACK },
        { key: '2', rgb: WHITE }
      ],
      320,
      180
    )
    const req = request(
      {
        mode: 'compilation',
        clips: [
          { start: 0.5, end: 2, label: 'a' },
          { start: 4.5, end: 8, label: 'b' }
        ]
      },
      timings
    )
    const target = join(outDir('compilation'), 'подборка рисунки.mp4')
    const { paths, result } = await run(beep, req, staged, target)
    expect(result.failures).toEqual([])
    const out = paths[0]
    // 1.5 + 3.5 + 1 (стоп-кадр) + 0.5 (стоп-кадр) = 6.5 с.
    expect(Math.abs((durationOf(out) as number) - 6.5)).toBeLessThanOrEqual(0.11)
    const dur = streamDurations(out)
    expect(Math.abs(dur.video - dur.audio)).toBeLessThanOrEqual(0.04)
    // «Писк» 7.0 с: до него 1.5 + 1 (первый отрезок с паузой) + (7 − 4.5) + 0.5 = 5.5.
    const beepAt = firstLoudSample(out) as number
    expect(Math.abs(beepAt - 5.5)).toBeLessThanOrEqual(0.04)
    await disposeStaged(staged)
  }, 90_000)

  it('видео без звука', async () => {
    const timings = [frameAt(2.02, 1)]
    const staged = await stage([{ key: '0', rgb: BLACK }])
    const { paths } = await run(CFR25, request({}, timings), staged, outDir('silent'))
    expect(hasAudio(paths[0])).toBe(false)
    await disposeStaged(staged)
  }, 60_000)

  it('весь файл со звуком одним отрезком: «Всё видео»', async () => {
    const withAudio = makeAudioVideo(work, 4)
    const timings = [range(1, 1)]
    const staged = await stage([{ key: '0', rgb: WHITE }], 320, 180)
    const { paths, result } = await run(
      withAudio,
      request({ clips: [{ start: 0, end: 4, label: 'Всё видео' }] }, timings),
      staged,
      outDir('whole')
    )
    expect(result.status).toBe('done')
    expect(Math.abs((durationOf(paths[0]) as number) - 4)).toBeLessThanOrEqual(0.06)
    expect(hasAudio(paths[0])).toBe(true)
    await disposeStaged(staged)
  }, 60_000)

  it('отмена: временные файлы графа убраны', async () => {
    const timings = [range(1.5, 0.5), frameAt(2.02, 1)]
    const staged = await stage([
      { key: '0', rgb: WHITE },
      { key: '1', rgb: BLACK }
    ])
    const controller = new AbortController()
    controller.abort()
    const dir = outDir('cancel')
    const { result } = await run(CFR25, request({}, timings), staged, dir, {
      signal: controller.signal
    })
    expect(result.status).toBe('cancelled')
    expect(readdirSync(dir)).toEqual([])
    expect(readdirSync(cyr).filter((n) => n.startsWith('flow-export-'))).toEqual([])
    await disposeStaged(staged)
    expect(liveCount()).toBe(0)
  }, 60_000)
})
