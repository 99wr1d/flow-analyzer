// Экспорт с лупой и прожектором на настоящем ffmpeg: по пикселям готового видео проверяется, что линза показывает
// увеличенный участок кадра в нужном масштабе, снаружи кадр не изменился, а прожектор затемняет всё, кроме пятна.
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, beforeEach } from 'vitest'
import type { Timing } from '../../shared/annotations'
import type { ExportRequest } from '../../shared/export'
import { loupeGeometry } from '../../shared/tools/loupe'
import { type JobOutput } from './job'
import { FFMPEG, FIXTURE, frameRgb, makePng, MODES, runJob, setTestMode } from './ffmpeg.testkit'
import { disposeStaged, stageOverlays, type Staged } from './staging'

const CFR25 = FIXTURE('cfr25.mp4')
const W = 640
const H = 360
let work: string

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-tools-test-'))
}, 60_000)
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

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

async function stage(images: Array<{ key: string; data: Uint8Array }>): Promise<Staged> {
  const res = await stageOverlays({ width: W, height: H, images }, work)
  if (!res.ok) throw new Error(res.error)
  stagedNow.push(res.staged)
  return res.staged
}

let counter = 0
function outDir(): string {
  counter += 1
  const dir = join(work, `out-${counter}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

interface LoupeSpec {
  index: number
  pos: { x: number; y: number }
  src: { x: number; y: number }
  radius: number
  zoom: number
}

async function exportWith(
  timings: Timing[],
  loupes: LoupeSpec[],
  clip: { start: number; end: number },
  images: Array<{ key: string; data: Uint8Array }>
): Promise<string> {
  const staged = await stage(images)
  const request: ExportRequest = {
    videoId: 'x',
    clips: [{ ...clip, label: 'Гол' }],
    mode: 'files',
    precision: 'precise',
    padding: 0,
    projectName: null,
    drawings: { token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11', fps: 25, timings, loupes }
  }
  const out: JobOutput = await runJob({
    ffmpegPath: FFMPEG,
    inputPath: CFR25,
    request,
    target: outDir(),
    overlays: staged,
    tempRoot: work
  })
  expect(out.result.failures).toEqual([])
  expect(out.result.status).toBe('done')
  return out.paths[0]
}

type Rgb = [number, number, number]

/** Билинейная выборка из кадра rgb24 (координаты — центры пикселей). */
function sample(frame: Buffer, x: number, y: number): Rgb {
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(H - 1, Math.floor(y)))
  const x1 = Math.min(W - 1, x0 + 1)
  const y1 = Math.min(H - 1, y0 + 1)
  const fx = Math.max(0, Math.min(1, x - x0))
  const fy = Math.max(0, Math.min(1, y - y0))
  const at = (xx: number, yy: number, c: number): number => frame[(yy * W + xx) * 3 + c]
  return [0, 1, 2].map(
    (c) =>
      at(x0, y0, c) * (1 - fx) * (1 - fy) +
      at(x1, y0, c) * fx * (1 - fy) +
      at(x0, y1, c) * (1 - fx) * fy +
      at(x1, y1, c) * fx * fy
  ) as Rgb
}

const px = (frame: Buffer, x: number, y: number): Rgb => {
  const i = (y * W + x) * 3
  return [frame[i], frame[i + 1], frame[i + 2]]
}
const diff = (a: Rgb, b: Rgb): number =>
  (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3

const TRANSPARENT = makePng(W, H)

describe.each(MODES)('экспорт с лупой (ffmpeg) [$name]', (mode) => {
  beforeEach(() => setTestMode(mode))
  // Линза в правом верхнем углу показывает центр кадра (там крупно нарисован номер кадра) в увеличении ×2.
  const loupe: LoupeSpec = {
    index: 0,
    pos: { x: 0.8, y: 0.3 },
    src: { x: 0.5, y: 0.5 },
    radius: 0.12,
    zoom: 2
  }
  const g = loupeGeometry(loupe, W, H)

  /** Среднее расхождение линзы с ожидаемым увеличенным участком исходного кадра (внутри круга). */
  function lensError(out: Buffer, src: Buffer, scale: number): number {
    let sum = 0
    let n = 0
    for (let v = 4; v < g.d - 4; v += 3) {
      for (let u = 4; u < g.d - 4; u += 3) {
        if (Math.hypot(u + 0.5 - g.d / 2, v + 0.5 - g.d / 2) > g.d / 2 - 4) continue
        const sx = g.sx + ((u + 0.5) * g.sw) / g.d - 0.5
        const sy = g.sy + ((v + 0.5) * g.sw) / g.d - 0.5
        // scale = 1: сравнение с неувеличенным кадром в том же месте (контрольное).
        const expected = scale === 1 ? px(src, g.ox + u, g.oy + v) : sample(src, sx, sy)
        sum += diff(px(out, g.ox + u, g.oy + v), expected)
        n += 1
      }
    }
    return sum / n
  }

  it('«Отрезок»: внутри линзы — увеличенный участок, снаружи кадр не тронут, вне окна линзы нет', async () => {
    // Лупа видна 1.0–2.0 с; клип 0.5–2.5 с, так что до и после неё есть обычные кадры.
    const out = await exportWith([range(1, 1)], [loupe], { start: 0.5, end: 2.5 }, [
      { key: '0', data: TRANSPARENT }
    ])
    const outFrame = (i: number): Buffer => frameRgb(out, i, W, H)
    const srcFrame = (i: number): Buffer => frameRgb(CFR25, 13 + i, W, H)

    // Кадр 20 результата (t = 1.3 с) внутри окна.
    const inside = outFrame(20)
    const insideSrc = srcFrame(20)
    const magnified = lensError(inside, insideSrc, 2)
    const plain = lensError(inside, insideSrc, 1)
    console.log(
      'Лупа: расхождение с увеличенным участком =',
      magnified.toFixed(1),
      '; с неувеличенным =',
      plain.toFixed(1)
    )
    // Резкие края цифр и сжатие H.264 дают несколько единиц расхождения; без увеличения оно в 9 раз больше.
    expect(magnified).toBeLessThan(20)
    expect(plain).toBeGreaterThan(magnified * 2.5)

    // Снаружи линзы — исходный кадр (с поправкой на сжатие H.264).
    for (const [x, y] of [
      [10, 10],
      [320, 340],
      [100, 200],
      [g.ox - 8, g.oy + g.d / 2],
      [g.ox + g.d + 8, g.oy + g.d / 2]
    ]) {
      expect(diff(px(inside, x, y), px(insideSrc, x, y))).toBeLessThan(12)
    }
    // Углы квадрата вокруг круга линзы остаются исходными: линза круглая.
    for (const [dx, dy] of [
      [2, 2],
      [g.d - 3, 2],
      [2, g.d - 3],
      [g.d - 3, g.d - 3]
    ]) {
      expect(
        diff(px(inside, g.ox + dx, g.oy + dy), px(insideSrc, g.ox + dx, g.oy + dy))
      ).toBeLessThan(12)
    }
    // Центр линзы — центр исходного участка (там крупные цифры номера кадра).
    expect(diff(px(inside, g.ox + g.d / 2, g.oy + g.d / 2), px(insideSrc, 320, 180))).toBeLessThan(
      18
    )

    // До окна и после него линзы нет: кадр совпадает с исходным и в области линзы.
    for (const i of [3, 48]) {
      const frame = outFrame(i)
      const original = srcFrame(i)
      expect(lensError(frame, original, 1)).toBeLessThan(12)
    }
  }, 90_000)

  it('масштаб ×3 показывает меньший участок, чем ×2', async () => {
    const out = await exportWith([range(1, 1)], [{ ...loupe, zoom: 3 }], { start: 1, end: 2 }, [
      { key: '0', data: TRANSPARENT }
    ])
    const g3 = loupeGeometry({ ...loupe, zoom: 3 }, W, H)
    expect(g3.sw).toBeLessThan(g.sw)
    const frame = frameRgb(out, 8, W, H)
    const src = frameRgb(CFR25, 33, W, H)
    let sum = 0
    let n = 0
    for (let v = 6; v < g3.d - 6; v += 4) {
      for (let u = 6; u < g3.d - 6; u += 4) {
        if (Math.hypot(u + 0.5 - g3.d / 2, v + 0.5 - g3.d / 2) > g3.d / 2 - 6) continue
        const sx = g3.sx + ((u + 0.5) * g3.sw) / g3.d - 0.5
        const sy = g3.sy + ((v + 0.5) * g3.sw) / g3.d - 0.5
        sum += diff(px(frame, g3.ox + u, g3.oy + v), sample(src, sx, sy))
        n += 1
      }
    }
    expect(sum / n).toBeLessThan(20)
  }, 90_000)

  it('«Только кадр»: линза есть на стоп-кадре и там увеличивает участок замершего кадра', async () => {
    // Стоп-кадр на кадре 50 исходника (2.02 с), 1 с.
    const out = await exportWith([frameAt(2.02, 1)], [loupe], { start: 1.5, end: 3 }, [
      { key: '0', data: TRANSPARENT }
    ])
    // Результат: обычные кадры 1.5–2.0 с (≈13 кадров), затем стоп-кадр на 25 кадров; кадр 25 — середина стоп-кадра.
    const freezeOut = frameRgb(out, 25, W, H)
    const freezeSrc = frameRgb(CFR25, 50, W, H)
    expect(lensError(freezeOut, freezeSrc, 2)).toBeLessThan(20)
    expect(lensError(freezeOut, freezeSrc, 1)).toBeGreaterThan(20)
    // Обычные кадры до стоп-кадра линзы не имеют.
    const before = frameRgb(out, 5, W, H)
    const beforeSrc = frameRgb(CFR25, 43, W, H)
    expect(lensError(before, beforeSrc, 1)).toBeLessThan(10)
  }, 90_000)
})

describe.each(MODES)('экспорт с прожектором (ffmpeg) [$name]', (mode) => {
  beforeEach(() => setTestMode(mode))
  const DIM = 0.55
  const CX = 320
  const CY = 180
  const R = 60
  /** Картинка прожектора: чёрное затемнение с прозрачным пятном, край пятна мягкий (как в приложении). */
  const dimPng = makePng(W, H, (x, y) => {
    const d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY)
    const lit = Math.max(0, Math.min(1, (R + 5 - d) / 10))
    return [0, 0, 0, Math.round(DIM * 255 * (1 - lit))]
  })

  it('углы темнее в (1 − затемнение) раза, центр пятна не меняется', async () => {
    const out = await exportWith([range(1, 1)], [], { start: 1, end: 2 }, [
      { key: '0', data: dimPng }
    ])
    const frame = frameRgb(out, 8, W, H)
    const src = frameRgb(CFR25, 33, W, H)
    // Контрольные точки вне пятна: углы и середины краёв, где исходный кадр достаточно яркий.
    const points: Array<[number, number]> = [
      [8, 8],
      [631, 8],
      [8, 351],
      [631, 351],
      [320, 8],
      [320, 351],
      [8, 180],
      [631, 180],
      [150, 100],
      [500, 260]
    ]
    const ratios: number[] = []
    for (const [x, y] of points) {
      const s = px(src, x, y)
      const o = px(frame, x, y)
      const ls = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2]
      const lo = 0.299 * o[0] + 0.587 * o[1] + 0.114 * o[2]
      if (ls > 60) ratios.push(lo / ls)
    }
    expect(ratios.length).toBeGreaterThanOrEqual(4)
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length
    console.log(
      'Прожектор: средний коэффициент яркости вне пятна =',
      mean.toFixed(3),
      'ожидалось',
      1 - DIM
    )
    expect(Math.abs(mean - (1 - DIM))).toBeLessThan(0.06)
    // Центр пятна и точки внутри него (до границы с запасом) не изменились.
    for (const [dx, dy] of [
      [0, 0],
      [30, 0],
      [0, -30],
      [-25, 25]
    ]) {
      expect(diff(px(frame, CX + dx, CY + dy), px(src, CX + dx, CY + dy))).toBeLessThan(12)
    }
  }, 90_000)

  it('затемнение 20 % и 80 %: коэффициент яркости соответствует силе', async () => {
    for (const dim of [0.2, 0.8]) {
      const png = makePng(W, H, (x, y) => {
        const d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY)
        const lit = Math.max(0, Math.min(1, (R + 5 - d) / 10))
        return [0, 0, 0, Math.round(dim * 255 * (1 - lit))]
      })
      const out = await exportWith([range(1, 1)], [], { start: 1, end: 2 }, [
        { key: '0', data: png }
      ])
      const frame = frameRgb(out, 8, W, H)
      const src = frameRgb(CFR25, 33, W, H)
      const s = px(src, 631, 8)
      const o = px(frame, 631, 8)
      const ls = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2]
      const lo = 0.299 * o[0] + 0.587 * o[1] + 0.114 * o[2]
      expect(ls).toBeGreaterThan(60)
      expect(Math.abs(lo / ls - (1 - dim))).toBeLessThan(0.07)
    }
  }, 120_000)
})
