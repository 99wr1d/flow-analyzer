// Рисунки «под игроками» на настоящем ffmpeg: по пикселям готового видео проверяется, что там, где рисунок идёт по траве,
// виден его цвет, там, где он пересекает «игрока» (красный прямоугольник), виден игрок, а подпись «поверх всего» видна везде.
// Кадр — tests/fixtures/players.mp4 (газон с полосами и шумом, три цветных «игрока», белая линия), см. scripts/make-fixtures.mjs.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, beforeEach } from 'vitest'
import type { Timing } from '../../shared/annotations'
import type { ExportRequest } from '../../shared/export'
import {
  DEFAULT_GRASS_BLEND,
  DEFAULT_GRASS_SIMILARITY,
  type GrassKeyValues
} from '../../shared/grassKey'
import { loupeGeometry } from '../../shared/tools/loupe'

import {
  FFMPEG,
  FIXTURE,
  countFrames,
  durationOf,
  ff,
  frameRgb,
  hasAudio,
  makePng,
  MODES,
  runJob,
  setTestMode
} from './ffmpeg.testkit'
import { disposeStaged, stageOverlays, type Staged } from './staging'

const SRC = FIXTURE('players.mp4')
const INFO = JSON.parse(readFileSync(FIXTURE('players.json'), 'utf8')) as {
  players: Array<{ name: string; x: number; y: number; w: number; h: number; color: string }>
}
const W = 640
const H = 360
const GRASS: GrassKeyValues = {
  color: '#2a7d3e',
  similarity: DEFAULT_GRASS_SIMILARITY,
  blend: DEFAULT_GRASS_BLEND
}
let work: string
/** Исходное видео текущего экспорта (по умолчанию — players.mp4; тест со звуком подменяет). */
let source = SRC

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-under-test-'))
}, 60_000)
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})
const stagedNow: Staged[] = []
afterEach(async () => {
  for (const s of stagedNow.splice(0)) await disposeStaged(s)
})

type Rgb = [number, number, number]
const RING: Rgb = [255, 0, 255] // «кольцо» — пурпурная горизонтальная полоса через трёх игроков
const LABEL: Rgb = [0, 220, 255] // подпись поверх всего
const RING_BAND = { y0: 190, y1: 202, x0: 40, x1: 600 }
const LABEL_BOX = { x0: 124, y0: 150, x1: 160, y1: 164 } // на теле красного игрока
const red = INFO.players.find((p) => p.name === 'red')!
const blue = INFO.players.find((p) => p.name === 'blue')!

const ringPng = (): Uint8Array =>
  makePng(W, H, (x, y) =>
    x >= RING_BAND.x0 && x < RING_BAND.x1 && y >= RING_BAND.y0 && y < RING_BAND.y1
      ? [...RING, 255]
      : [0, 0, 0, 0]
  )
const labelPng = (): Uint8Array =>
  makePng(W, H, (x, y) =>
    x >= LABEL_BOX.x0 && x < LABEL_BOX.x1 && y >= LABEL_BOX.y0 && y < LABEL_BOX.y1
      ? [...LABEL, 255]
      : [0, 0, 0, 0]
  )

const range = (start: number, duration: number): Timing => ({ mode: 'range', start, duration })
const frameAt = (start: number, freezeSeconds: number): Timing => ({
  mode: 'frame',
  start,
  freezeSeconds
})

let counter = 0
const outDir = (): string => {
  counter += 1
  const dir = join(work, `out-${counter}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

interface Images {
  under?: Record<string, Uint8Array>
  over?: Record<string, Uint8Array>
}

async function exportWith(
  timings: Timing[],
  clips: Array<{ start: number; end: number }>,
  images: Images,
  mode: 'files' | 'compilation' = 'files',
  loupes: ExportRequest['drawings'] extends infer D
    ? D extends { loupes: infer L }
      ? L
      : never
    : never = []
): Promise<string[]> {
  const list = [
    ...Object.entries(images.over ?? {}).map(([key, data]) => ({
      key,
      data,
      layer: 'over' as const
    })),
    ...Object.entries(images.under ?? {}).map(([key, data]) => ({
      key,
      data,
      layer: 'under' as const
    }))
  ]
  const res = await stageOverlays({ width: W, height: H, images: list }, work)
  if (!res.ok) throw new Error(res.error)
  stagedNow.push(res.staged)
  const request: ExportRequest = {
    videoId: 'x',
    clips: clips.map((c) => ({ ...c, label: 'Гол' })),
    mode,
    precision: 'precise',
    padding: 0,
    projectName: null,
    drawings: {
      token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
      fps: 25,
      timings,
      loupes,
      grass: GRASS
    }
  }
  const out = await runJob({
    ffmpegPath: FFMPEG,
    inputPath: source,
    request,
    target: mode === 'files' ? outDir() : join(outDir(), 'compilation.mp4'),
    overlays: res.staged,
    tempRoot: work
  })
  expect(out.result.failures).toEqual([])
  expect(out.result.status).toBe('done')
  return out.paths
}

const px = (frame: Buffer, x: number, y: number): Rgb => {
  const i = (y * W + x) * 3
  return [frame[i], frame[i + 1], frame[i + 2]]
}
const dist = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
const hex = (c: string): Rgb => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16)
]

/** Проверки одного кадра результата. */
function checkFrame(frame: Buffer, name: string): void {
  const ringY = 196
  // Трава на пути «кольца»: виден цвет кольца (с допуском на сжатие H.264).
  for (const x of [60, 90, 230, 260, 400, 450, 560, 590]) {
    expect(dist(px(frame, x, ringY), RING), `${name}: трава x=${x}`).toBeLessThan(40)
  }
  // Кольцо пересекает красного и синего игроков: видны игроки, а не кольцо.
  expect(dist(px(frame, red.x + 22, ringY), hex(red.color)), `${name}: красный игрок`).toBeLessThan(
    40
  )
  expect(dist(px(frame, blue.x + 22, ringY), hex(blue.color)), `${name}: синий игрок`).toBeLessThan(
    40
  )
  // Подпись поверх всего: видна даже на теле игрока.
  expect(dist(px(frame, 142, 157), LABEL), `${name}: подпись`).toBeLessThan(40)
  // Вне полосы кольца кадр не тронут: трава и игрок как в исходнике.
  expect(dist(px(frame, red.x + 22, 230), hex(red.color))).toBeLessThan(40)
}

/** Кольцо под игроками: трава в цвете кольца, игрок его закрывает. */
function checkFrameUnder(frame: Buffer, name: string): void {
  expect(dist(px(frame, 60, 196), RING), `${name}: трава`).toBeLessThan(40)
  expect(dist(px(frame, red.x + 22, 196), hex(red.color)), `${name}: игрок`).toBeLessThan(40)
}

describe.each(MODES)('экспорт с рисунками «под игроками» (ffmpeg) [$name]', (mode) => {
  beforeEach(() => setTestMode(mode))
  it('«Отрезок»: кольцо видно на траве, игроки его закрывают, подпись поверх видна', async () => {
    const [file] = await exportWith([range(0, 3), range(0, 3)], [{ start: 0.2, end: 2 }], {
      under: { '0-1': ringPng() },
      over: { '0-1': labelPng() }
    })
    checkFrame(frameRgb(file, 10, W, H), 'кадр 10')
    checkFrame(frameRgb(file, 30, W, H), 'кадр 30')
    // Для просмотра глазами: FLOW_SHOTS=папка сохраняет кадр результата.
    const shots = process.env.FLOW_SHOTS
    if (shots) {
      ff([
        '-i',
        file,
        '-vf',
        'select=eq(n\\,10)',
        '-frames:v',
        '1',
        '-y',
        join(shots, 'under-export-ffmpeg.png')
      ])
    }
  }, 120_000)

  it('контроль: то же кольцо в слое «поверх всего» закрывает и игроков', async () => {
    const [file] = await exportWith([range(0, 3)], [{ start: 0.2, end: 1 }], {
      over: { '0': ringPng() }
    })
    const frame = frameRgb(file, 5, W, H)
    expect(dist(px(frame, red.x + 22, 196), RING)).toBeLessThan(40)
    expect(dist(px(frame, 60, 196), RING)).toBeLessThan(40)
  }, 120_000)

  it('край игрока: переход от кольца к игроку узкий (несколько пикселей), без полос по траве', async () => {
    const [file] = await exportWith([range(0, 3)], [{ start: 0.2, end: 1 }], {
      under: { '0': ringPng() }
    })
    const frame = frameRgb(file, 5, W, H)
    const row = (x: number): Rgb => px(frame, x, 196)
    // Слева от красного игрока (его край — x = 120): с x = 112 и левее уже чистое кольцо, с x = 124 — чистый игрок.
    expect(dist(row(110), RING)).toBeLessThan(40)
    expect(dist(row(126), hex(red.color))).toBeLessThan(40)
    // Правый край (x = 164).
    expect(dist(row(158), hex(red.color))).toBeLessThan(40)
    expect(dist(row(172), RING)).toBeLessThan(40)
    // Вдали от игроков (нет ни одного «сорванного» пикселя): вся трава на полосе — цвета кольца.
    let bad = 0
    for (let x = 60; x < 110; x += 1) if (dist(row(x), RING) > 40) bad += 1
    expect(bad).toBe(0)
  }, 120_000)

  it('стоп-кадр: рисунок «только кадр» на замершем кадре тоже под игроком', async () => {
    // Рисунок только на кадре 25 (t = 1.02 с), стоп-кадр 1 с. Клип 0.5–2.
    const [file] = await exportWith(
      [frameAt(1.02, 1), frameAt(1.02, 1)],
      [{ start: 0.5, end: 2 }],
      { under: { '0-1': ringPng() }, over: { '0-1': labelPng() } }
    )
    // Кадр 25 клипа — 0.5 с после начала = кадр 12.5 → стоп-кадр начинается на кадре 13 результата.
    // Берём кадр внутри стоп-кадра (результат: 12 кадров до + 1 + 25 повторов).
    checkFrame(frameRgb(file, 20, W, H), 'стоп-кадр')
    // До стоп-кадра рисунков нет: кадр 3 чистый.
    expect(dist(px(frameRgb(file, 3, W, H), 60, 196), RING)).toBeGreaterThan(80)
  }, 120_000)

  it('подборка из двух клипов: рисунок под игроками на обоих, вне окна его нет', async () => {
    // Рисунок виден 0.2–0.8 с и 1.6–2.2 с (два сегмента), подборка: клипы 0–1 и 1.5–2.5.
    const [file] = await exportWith(
      [range(0.2, 0.6), range(0.2, 0.6), range(1.6, 0.6), range(1.6, 0.6)],
      [
        { start: 0, end: 1 },
        { start: 1.5, end: 2.5 }
      ],
      {
        under: { '0-1': ringPng(), '2-3': ringPng() },
        over: { '0-1': labelPng(), '2-3': labelPng() }
      },
      'compilation'
    )
    // Первый клип: кадр 10 (0.4 с) внутри окна.
    checkFrame(frameRgb(file, 10, W, H), 'подборка, клип 1')
    // Первый клип, кадр 2 (0.08 с): рисунка ещё нет.
    expect(dist(px(frameRgb(file, 2, W, H), 60, 196), RING)).toBeGreaterThan(80)
    // Второй клип начинается на кадре 25 результата; 1.6 с — кадр 25 + 2 (1.6 − 1.5 = 0.1 с = 2.5 кадра).
    checkFrame(frameRgb(file, 25 + 5, W, H), 'подборка, клип 2')
    // Второй клип, кадр 25 (1.5 с): рисунка нет.
    expect(dist(px(frameRgb(file, 25, W, H), 60, 196), RING)).toBeGreaterThan(80)
  }, 120_000)

  it('два стоп-кадра с одним обычным кадром между ними: кадр не теряется, рисунок под игроками на всех', async () => {
    // Клип 0.2–1.2 (кадры 5..29), стоп-кадры на кадрах 13 и 15 по 1 с, между ними кадр 14.
    const [file] = await exportWith(
      [range(0, 3), frameAt(0.54, 1), frameAt(0.62, 1)],
      [{ start: 0.2, end: 1.2 }],
      { under: { '0': ringPng(), '0-1': ringPng(), '0-2': ringPng() }, over: { '0-1': labelPng() } }
    )
    expect(countFrames(file)).toBe(25 + 50)
    // Выход: кадры 5..12 (8), кадр 13 ×26, кадр 14 (индекс 34), кадр 15 ×26, дальше 16..29.
    checkFrameUnder(frameRgb(file, 34, W, H), 'одиночный кадр')
    checkFrameUnder(frameRgb(file, 20, W, H), 'первый стоп-кадр')
    checkFrameUnder(frameRgb(file, 50, W, H), 'второй стоп-кадр')
    checkFrameUnder(frameRgb(file, 70, W, H), 'после стоп-кадров')
  }, 120_000)

  it('лупа: линза увеличивает уже готовую картинку (ключ раньше лупы): кольцо на траве есть, на игроке нет', async () => {
    // Линза в правом верхнем углу смотрит на участок вокруг (118, 196) — трава, кольцо и левый край красного игрока.
    const loupe = {
      index: 1,
      pos: { x: 0.85, y: 0.25 },
      src: { x: 118 / W, y: 196 / H },
      radius: 0.15,
      zoom: 2
    }
    const g = loupeGeometry(loupe, W, H)
    const lens = (x: number, y: number): [number, number] => [
      Math.round(g.ox + ((x - g.sx + 0.5) * g.d) / g.sw - 0.5),
      Math.round(g.oy + ((y - g.sy + 0.5) * g.d) / g.sw - 0.5)
    ]
    const [file] = await exportWith(
      [range(0, 3), range(0, 3)],
      [{ start: 0.2, end: 1.2 }],
      { under: { '0-1': ringPng() } },
      'files',
      [loupe]
    )
    const frame = frameRgb(file, 10, W, H)
    const onGrass = lens(105, 196)
    const onPlayer = lens(red.x + 12, 196)
    console.log(
      'Лупа: кольцо на траве в линзе',
      px(frame, ...onGrass),
      '; на игроке',
      px(frame, ...onPlayer)
    )
    expect(dist(px(frame, ...onGrass), RING)).toBeLessThan(40)
    expect(dist(px(frame, ...onPlayer), hex(red.color))).toBeLessThan(40)
    // Вне линзы то же, что и без лупы: кольцо на траве, игрок чистый.
    expect(dist(px(frame, 60, 196), RING)).toBeLessThan(40)
    expect(dist(px(frame, red.x + 22, 196), hex(red.color))).toBeLessThan(40)
  }, 120_000)

  it('звук: со стоп-кадром и рисунком под игроками звук остаётся, длительность сходится', async () => {
    const withAudio = join(work, 'players-audio.mp4')
    const mux = ff([
      ...['-i', SRC, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3'],
      ...['-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-y', withAudio]
    ])
    expect(mux.status).toBe(0)
    source = withAudio
    try {
      const [file] = await exportWith(
        [frameAt(1.02, 1), frameAt(1.02, 1)],
        [{ start: 0.5, end: 2 }],
        { under: { '0-1': ringPng() }, over: { '0-1': labelPng() } }
      )
      expect(hasAudio(file)).toBe(true)
      // 1.5 с клипа + 1 с стоп-кадра.
      expect(Math.abs((durationOf(file) ?? 0) - 2.5)).toBeLessThan(0.1)
      checkFrame(frameRgb(file, 20, W, H), 'стоп-кадр со звуком')
    } finally {
      source = SRC
    }
  }, 120_000)
})
