// Экспорт движущихся рисунков на настоящем ffmpeg (этап 16б): ряды PNG по кадрам накладываются в точные кадры,
// стоп-кадр держит геометрию своего кадра, слой «под игроками» остаётся ключом по газону, отмена убирает временные файлы.
// «Рисунок» здесь — цветной квадрат: его положение и размер считает та же shared-анимация (geomAt), что и в приложении.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it, beforeEach } from 'vitest'
import type { Annotation, Circle, Timing } from '../../shared/annotations'
import { geomAt, setKeyEase, startAnimation, applyGeomEdit } from '../../shared/animation'
import type { ExportRequest } from '../../shared/export'
import { frameTime, planExport } from '../../shared/exportOverlays'
import {
  DEFAULT_GRASS_BLEND,
  DEFAULT_GRASS_SIMILARITY,
  type GrassKeyValues
} from '../../shared/grassKey'
import { fitHomography, type Correspondence } from '../../shared/pitch/homography'
import { penaltyAreaRect } from '../../shared/pitch/landmarks'
import { lookAtCamera } from '../../shared/pitch/pitch.testkit'
import { makeProjector } from '../../shared/pitch/projector'
import {
  FFMPEG,
  FIXTURE,
  boxPng,
  frameRgb,
  makePng,
  MODES,
  runJob,
  setTestMode
} from './ffmpeg.testkit'
import { disposeStaged, holdStaged, stageFrames, stageOverlays, type Staged } from './staging'

const CFR25 = FIXTURE('cfr25.mp4')
const PLAYERS = FIXTURE('players.mp4')
const W = 640
const H = 360
const FPS = 25
const GRASS: GrassKeyValues = {
  color: '#2a7d3e',
  similarity: DEFAULT_GRASS_SIMILARITY,
  blend: DEFAULT_GRASS_BLEND
}
const MAGENTA: [number, number, number] = [255, 0, 255]
const BLACK: [number, number, number] = [0, 0, 0]
/** Строка кадра, где ищем квадрат: низ кадра (полосы без цифр). */
const ROW = 330
const isMagenta = ([r, g, b]: number[]): boolean => r > 200 && g < 90 && b > 200

let work: string
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-anim-test-'))
}, 60_000)
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})
const stagedNow: Staged[] = []
afterEach(async () => {
  for (const s of stagedNow.splice(0)) await disposeStaged(s)
})

const style = { color: '#ffd60a', width: 0.008, dash: 'solid' as const }
const id = '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11'

/** Круг на экране с центром (cx, cy) долей кадра, шириной 0.1 по x. */
const circleAt = (cx: number, cy: number): Circle => ({
  id,
  space: 'screen',
  type: 'circle',
  p1: { x: cx - 0.05, y: cy - 0.05 },
  p2: { x: cx + 0.05, y: cy + 0.05 },
  style,
  timing: { mode: 'range', start: 1, duration: 1 }
})

/** Круг едет слева (x = 0.2 в кадре 25, t = 1.02) направо (x = 0.7 в кадре 50, t = 2.02), равномерно. */
function movingCircle(): Annotation {
  const a0 = startAnimation(circleAt(0.2, 0.5), 1.0, FPS, 60)
  const moved = circleAt(0.7, 0.5)
  return setKeyEase(
    applyGeomEdit(a0, { ...a0, p1: moved.p1, p2: moved.p2 } as Annotation, 2.0, FPS),
    0,
    'linear'
  )
}

type BoxSpec = { cx: number; cy: number; size: number; rgb: [number, number, number] }
const boxFrame = (b: BoxSpec | null): Uint8Array =>
  b
    ? boxPng(
        W,
        H,
        {
          x0: Math.round(b.cx - b.size / 2),
          y0: Math.round(b.cy - b.size / 2),
          x1: Math.round(b.cx + b.size / 2),
          y1: Math.round(b.cy + b.size / 2)
        },
        b.rgb
      )
    : makePng(W, H)

interface AnimCase {
  source: string
  timings: Timing[]
  animated: number[]
  clips: Array<{ start: number; end: number }>
  /** Картинка кадра f для слоя (null — пустая). */
  frame: (f: number, members: number[], layer: 'over' | 'under') => BoxSpec | null
  layers: { over: boolean; under: boolean }
  /** Статические картинки: ключ → слой → прямоугольник. */
  statics?: Array<{ key: string; layer: 'over' | 'under'; png: Uint8Array }>
  signal?: AbortSignal
  mode?: 'files' | 'compilation'
  loupes?: NonNullable<ExportRequest['drawings']>['loupes']
}

let counter = 0
async function exportAnimated(
  c: AnimCase
): Promise<{ paths: string[]; staged: Staged; tempDirs: string[] }> {
  const plans = planExport(c.clips, c.mode ?? 'files', c.timings, FPS, new Set(c.animated))
  const res = await stageOverlays(
    { width: W, height: H, images: (c.statics ?? []).map((s) => ({ ...s, data: s.png })) },
    work
  )
  if (!res.ok) throw new Error(res.error)
  const staged = res.staged
  stagedNow.push(staged)
  await holdStaged(staged)
  const frames = new Map<number, number[]>()
  for (const p of plans) for (const f of p.animation.frames) frames.set(f.frame, f.members)
  for (const layer of ['over', 'under'] as const) {
    if (!c.layers[layer]) continue
    const list = [...frames.entries()].map(([frame, members]) => ({
      frame,
      data: boxFrame(c.frame(frame, members, layer))
    }))
    for (let i = 0; i < list.length; i += 50) {
      const r = await stageFrames({ token: staged.token, layer, frames: list.slice(i, i + 50) })
      if (!r.ok) throw new Error(r.error)
    }
  }
  counter += 1
  const dir = join(work, `out-${counter}`)
  mkdirSync(dir, { recursive: true })
  const request: ExportRequest = {
    videoId: 'x',
    clips: c.clips.map((k) => ({ ...k, label: 'Гол' })),
    mode: c.mode ?? 'files',
    precision: 'precise',
    padding: 0,
    projectName: null,
    drawings: {
      token: staged.token,
      fps: FPS,
      timings: c.timings,
      loupes: c.loupes ?? [],
      animated: c.animated,
      animLayers: c.layers,
      ...(c.layers.under ? { grass: GRASS } : {})
    }
  }
  const out = await runJob({
    ffmpegPath: FFMPEG,
    inputPath: c.source,
    request,
    target: c.mode === 'compilation' ? join(dir, 'c.mp4') : dir,
    overlays: staged,
    tempRoot: work,
    signal: c.signal
  })
  if (!c.signal) {
    expect(out.result.failures).toEqual([])
    expect(out.result.status).toBe('done')
  }
  return {
    paths: out.paths,
    staged,
    tempDirs: readdirSync(work).filter((n) => n.startsWith('flow-export-'))
  }
}

/**
 * Центр по x и ширина «нарисованного» квадрата в строке y кадра результата n: пиксели, отличающиеся от исходного
 * кадра source (номер sourceFrame) больше порога. null — отличий нет. Исходник — цветные полосы, поэтому сравниваем с ним.
 */
function boxInRow(
  path: string,
  n: number,
  y: number,
  source: { path: string; frame: number } | null,
  test: (rgb: number[]) => boolean = () => true
): { cx: number; width: number } | null {
  const rgb = frameRgb(path, n, W, H)
  const base = source ? frameRgb(source.path, source.frame, W, H) : null
  let min = Infinity
  let max = -Infinity
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3
    const px = [rgb[i], rgb[i + 1], rgb[i + 2]]
    const differs = base
      ? Math.max(
          Math.abs(px[0] - base[i]),
          Math.abs(px[1] - base[i + 1]),
          Math.abs(px[2] - base[i + 2])
        ) > 100
      : test(px)
    if (differs) {
      min = Math.min(min, x)
      max = Math.max(max, x)
    }
  }
  return max < 0 ? null : { cx: (min + max + 1) / 2, width: max - min + 1 }
}

describe.each(MODES)('движущиеся рисунки в экспорте (ffmpeg) [$name]', (mode) => {
  beforeEach(() => setTestMode(mode))
  it('круг едет слева направо за секунду: в кадрах 0, 12 и 24 центр там, где его считает анимация (±2 px)', async () => {
    const a = movingCircle()
    const { paths } = await exportAnimated({
      source: CFR25,
      timings: [a.timing],
      animated: [0],
      clips: [{ start: 1, end: 2 }],
      layers: { over: true, under: false },
      frame: (f) => {
        const g = geomAt(a, frameTime(f, FPS)) as {
          p1: { x: number; y: number }
          p2: { x: number }
        }
        return { cx: ((g.p1.x + g.p2.x) / 2) * W, cy: ROW, size: 30, rgb: BLACK }
      }
    })
    const seen: number[] = []
    if (process.env.DBG) {
      const list: string[] = []
      for (let n = 0; n < 25; n += 1) {
        const f = boxInRow(paths[0], n, ROW, { path: CFR25, frame: 25 + n })
        const g = geomAt(a, frameTime(25 + n, FPS)) as { p1: { x: number }; p2: { x: number } }
        list.push(`${n}:${f ? f.cx : '-'}/${(((g.p1.x + g.p2.x) / 2) * W).toFixed(0)}`)
      }
      console.log(list.join(' '))
    }
    for (const n of [0, 12, 24]) {
      const found = boxInRow(paths[0], n, ROW, { path: CFR25, frame: 25 + n })
      expect(found, `кадр ${n}`).not.toBeNull()
      const t = frameTime(25 + n, FPS)
      const g = geomAt(a, t) as { p1: { x: number }; p2: { x: number } }
      const expected = ((g.p1.x + g.p2.x) / 2) * W
      seen.push(found!.cx)
      expect(
        Math.abs(found!.cx - expected),
        `кадр ${n}: ${found!.cx} против ${expected}`
      ).toBeLessThanOrEqual(2)
    }
    // Двигается: слева направо, шагами порядка 150 px за полсекунды.
    expect(seen[1] - seen[0]).toBeGreaterThan(100)
    expect(seen[2] - seen[1]).toBeGreaterThan(100)
  }, 120_000)

  it('кольцо на поле уходит вглубь: радиус в пикселях уменьшается (метры → проекция)', async () => {
    const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)
    const pairs: Correspondence[] = penaltyAreaRect({ length: 105, width: 68 }, 'left').map(
      (w) => ({ world: w, image: cam.project(w)! })
    )
    const fit = fitHomography(pairs, cam.aspect)
    if (!fit.ok) throw new Error('камера теста не годится')
    const proj = makeProjector(fit.H)!
    const ring0: Annotation = {
      id,
      space: 'pitch',
      calibrationId: '4f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c22',
      type: 'ring',
      center: { x: 14, y: 60 },
      radius: 3,
      style,
      timing: { mode: 'range', start: 1, duration: 1 }
    }
    const a1 = startAnimation(ring0, 1.0, FPS, 60)
    const a = setKeyEase(
      applyGeomEdit(a1, { ...a1, center: { x: 14, y: 8 } } as Annotation, 2.0, FPS),
      0,
      'linear'
    )
    const spec = (f: number): BoxSpec => {
      const g = geomAt(a, frameTime(f, FPS)) as { center: { x: number; y: number }; radius: number }
      const c = proj.toImage(g.center)!
      const e = proj.toImage({ x: g.center.x + g.radius, y: g.center.y })!
      const r = Math.hypot((e.x - c.x) * W, (e.y - c.y) * H)
      return { cx: c.x * W, cy: c.y * H, size: 2 * r, rgb: BLACK }
    }
    const { paths } = await exportAnimated({
      source: CFR25,
      timings: [a.timing],
      animated: [0],
      clips: [{ start: 1, end: 2 }],
      layers: { over: true, under: false },
      frame: (f) => spec(f)
    })
    const w0 = spec(25).size
    const w24 = spec(49).size
    expect(w24).toBeLessThan(w0 * 0.7)
    const first = boxInRow(paths[0], 0, Math.round(spec(25).cy), { path: CFR25, frame: 25 })
    const last = boxInRow(paths[0], 24, Math.round(spec(49).cy), { path: CFR25, frame: 49 })
    expect(first && last).toBeTruthy()
    expect(last!.width).toBeLessThan(first!.width * 0.75)
    expect(Math.abs(first!.width - w0)).toBeLessThanOrEqual(3)
    expect(Math.abs(last!.width - w24)).toBeLessThanOrEqual(3)
  }, 120_000)

  it('«под игроками»: движущийся квадрат на траве виден, на игроке — игрок', async () => {
    const a = movingCircle()
    // Квадрат едет по строке y = 196 (через красного игрока x 120..164): в кадре 25 центр x = 128 (на игроке),
    // в кадре 49 — x = 448 (трава).
    const spec = (f: number): BoxSpec => {
      const t = (f - 25) / 24
      return {
        cx: 128 + (448 - 128) * Math.min(1, Math.max(0, t)),
        cy: 196,
        size: 20,
        rgb: MAGENTA
      }
    }
    const { paths } = await exportAnimated({
      source: PLAYERS,
      timings: [a.timing],
      animated: [0],
      clips: [{ start: 1, end: 2 }],
      layers: { over: false, under: true },
      frame: (f) => spec(f)
    })
    const onPlayer = boxInRow(paths[0], 0, 196, null, isMagenta)
    expect(onPlayer, 'на игроке квадрата не видно').toBeNull()
    const onGrass = boxInRow(paths[0], 24, 196, null, isMagenta)
    expect(onGrass).not.toBeNull()
    expect(Math.abs(onGrass!.cx - 448)).toBeLessThanOrEqual(3)
    // Посередине: между игроками красным и синим, на траве.
    const mid = boxInRow(paths[0], 12, 196, null, isMagenta)
    expect(mid).not.toBeNull()
    expect(Math.abs(mid!.cx - spec(37).cx)).toBeLessThanOrEqual(3)
  }, 120_000)

  it('стоп-кадр: на замершем кадре рисунок стоит в геометрии этого кадра, после стопа движение продолжается', async () => {
    const a = movingCircle()
    // Рисунок «только кадр» на кадре 38 (t = 1.54): стоп-кадр 1 с. Движущийся круг виден в нём.
    const timings: Timing[] = [a.timing, { mode: 'frame', start: 1.54, freezeSeconds: 1 }]
    const centre = (f: number): number => {
      const g = geomAt(a, frameTime(f, FPS)) as { p1: { x: number }; p2: { x: number } }
      return ((g.p1.x + g.p2.x) / 2) * W
    }
    const { paths } = await exportAnimated({
      source: CFR25,
      timings,
      animated: [0],
      clips: [{ start: 1, end: 2 }],
      layers: { over: true, under: false },
      statics: [
        { key: '1', layer: 'over', png: boxFrame({ cx: 40, cy: 40, size: 30, rgb: [0, 255, 255] }) }
      ],
      frame: (f) => ({ cx: centre(f), cy: ROW, size: 30, rgb: BLACK })
    })
    // Кадр 38 источника — кадр 13 результата; стоп-кадр: результат 13…38 одинаков и на геометрии кадра 38.
    const want = centre(38)
    for (const n of [13, 20, 30, 38]) {
      const found = boxInRow(paths[0], n, ROW, { path: CFR25, frame: 38 })
      expect(found, `кадр ${n}`).not.toBeNull()
      expect(Math.abs(found!.cx - want), `стоп-кадр ${n}`).toBeLessThanOrEqual(2)
    }
    // До стопа (кадр 6 источника 31) и после него (результат 39 = источник 39) геометрия своя.
    const before = boxInRow(paths[0], 6, ROW, { path: CFR25, frame: 31 })
    expect(Math.abs(before!.cx - centre(31))).toBeLessThanOrEqual(2)
    // Результат 39 = источник 39, значит результат 44 = источник 44.
    const after = boxInRow(paths[0], 44, ROW, { path: CFR25, frame: 44 })
    expect(Math.abs(after!.cx - centre(44))).toBeLessThanOrEqual(2)
    expect(after!.cx).toBeGreaterThan(want + 10)
  }, 120_000)

  it('подборка из двух клипов: движущийся рисунок есть в обоих', async () => {
    const a = movingCircle()
    const { paths } = await exportAnimated({
      source: CFR25,
      timings: [a.timing],
      animated: [0],
      clips: [
        { start: 0.4, end: 1.4 },
        { start: 1.4, end: 2.4 }
      ],
      mode: 'compilation',
      layers: { over: true, under: false },
      frame: (f) => {
        const g = geomAt(a, frameTime(f, FPS)) as { p1: { x: number }; p2: { x: number } }
        return { cx: ((g.p1.x + g.p2.x) / 2) * W, cy: ROW, size: 30, rgb: BLACK }
      }
    })
    // Первый клип: источник 10…34; рисунок с кадра 25 → результат 15 (источник 25).
    expect(boxInRow(paths[0], 5, ROW, { path: CFR25, frame: 15 })).toBeNull()
    const early = boxInRow(paths[0], 15, ROW, { path: CFR25, frame: 25 })
    expect(early).not.toBeNull()
    // Второй клип начинается с результата 25 (источник 35); рисунок идёт до кадра 49 (результат 25 + 14).
    const late = boxInRow(paths[0], 25 + 5, ROW, { path: CFR25, frame: 35 + 5 })
    expect(late).not.toBeNull()
    expect(late!.cx).toBeGreaterThan(early!.cx)
    // После конца рисунка (источник 55 → результат 25 + 20) его нет.
    expect(boxInRow(paths[0], 25 + 20, ROW, { path: CFR25, frame: 35 + 20 })).toBeNull()
  }, 120_000)

  it('отмена экспорта: ffmpeg останавливается, временные папки графа убираются, а после disposeStaged исчезают и кадры', async () => {
    const a = movingCircle()
    const controller = new AbortController()
    const p = exportAnimated({
      source: CFR25,
      timings: [a.timing],
      animated: [0],
      clips: [{ start: 0, end: 3 }],
      layers: { over: true, under: false },
      signal: controller.signal,
      frame: () => ({ cx: 100, cy: 100, size: 20, rgb: MAGENTA })
    })
    controller.abort()
    const { paths, staged, tempDirs } = await p
    expect(paths).toEqual([])
    expect(tempDirs).toEqual([])
    expect(existsSync(staged.dir)).toBe(true)
    await disposeStaged(staged)
    expect(existsSync(staged.dir)).toBe(false)
  }, 120_000)

  it('движущаяся лупа: линза едет вместе с ключами (выражения ffmpeg), источник остаётся своим', async () => {
    // Линза едет по низу кадра слева направо, а смотрит всё время на красную полосу (x = 50).
    const loupe = {
      index: 0,
      radius: 0.1,
      zoom: 2,
      pos: { x: 0.5, y: 0.8 },
      src: { x: 50 / W, y: 0.8 },
      keys: [
        {
          t: frameTime(25, FPS),
          ease: 'linear' as const,
          pos: { x: 0.5, y: 0.8 },
          src: { x: 50 / W, y: 0.8 }
        },
        {
          t: frameTime(50, FPS),
          ease: 'linear' as const,
          pos: { x: 0.85, y: 0.8 },
          src: { x: 50 / W, y: 0.8 }
        }
      ]
    }
    const { paths } = await exportAnimated({
      source: CFR25,
      timings: [{ mode: 'range', start: 1, duration: 1 }],
      animated: [0],
      clips: [{ start: 1, end: 2 }],
      layers: { over: false, under: false },
      loupes: [loupe],
      frame: () => null
    })
    const y = Math.round(0.8 * H)
    const redAt = (n: number, x: number): boolean => {
      const rgb = frameRgb(paths[0], n, W, H)
      const i = (y * W + Math.round(x)) * 3
      return rgb[i] > 200 && rgb[i + 1] < 60 && rgb[i + 2] < 60
    }
    const centreX = (n: number): number =>
      (0.5 + (0.85 - 0.5) * Math.min(1, Math.max(0, (n + 0.5 + 25 - 25.5) / 24.0 / 1))) * W
    // Кадр 0: линза в середине (x ≈ 320), в её центре красный; кадр 24: линза справа (x ≈ 544), слева уже обычная картинка.
    expect(redAt(0, centreX(0))).toBe(true)
    expect(redAt(12, centreX(12))).toBe(true)
    expect(redAt(24, centreX(24))).toBe(true)
    expect(redAt(24, 0.5 * W)).toBe(false)
    expect(redAt(0, 0.85 * W)).toBe(false)
  }, 120_000)
})
