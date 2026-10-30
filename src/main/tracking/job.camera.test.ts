// Слежение с учётом движения камеры: синтетические кадры с текстурным фоном, который едет, и заглушка-детектор,
// рамки которой едут вместе с фоном (игрок стоит на поле).
import { describe, expect, it } from 'vitest'
import { CameraEstimator } from '../camera/estimator'
import type { DecodedFrame } from './frames'
import { runTrackingJob, type RunTrackingOptions, type TrackingOutcome } from './job'
import { createStubDetector, type StubPattern } from './stubDetector'

const W = 480
const H = 270
const FPS = 25
/** Панорама, px/кадр при ширине кадра 480 (оценка движения надёжна до ≈ 28 px/кадр на этой текстуре; игрок мелкий, h ≈ 38 px: ворота GATE_BASE = 0.6 роста ≈ 23 px < PAN). */
const PAN = 24

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let s = 0
      for (let k = -r; k <= r; k += 1) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))]
      tmp[y * w + x] = s / (2 * r + 1)
    }
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let s = 0
      for (let k = -r; k <= r; k += 1) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]
      out[y * w + x] = s / (2 * r + 1)
    }
  return out
}

interface Base {
  data: Float32Array
  width: number
}

/** Широкая текстура-подложка (мелкий + крупный шум). */
function makeBase(seed: number, bw: number): Base {
  const rand = rng(seed)
  const fine = blur(
    blur(
      new Float32Array(bw * H).map(() => rand() * 255),
      bw,
      H,
      1
    ),
    bw,
    H,
    1
  )
  const coarse = blur(
    blur(
      new Float32Array(bw * H).map(() => rand() * 255),
      bw,
      H,
      4
    ),
    bw,
    H,
    4
  )
  return { data: fine.map((f, i) => 128 + (f - 128) * 2.2 + (coarse[i] - 128) * 4), width: bw }
}

/** Кадр k: окно подложки сдвинуто на shift px вправо (содержимое уезжает влево). flat — однотонный кадр (оценка ненадёжна). */
function frameAt(base: Base, k: number, shift: number, flat = false): DecodedFrame {
  const rand = rng(1000 + k)
  const rgba = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const v = flat
        ? 128
        : Math.max(
            0,
            Math.min(255, Math.round(base.data[y * base.width + x + shift] + rand() * 4 - 2))
          )
      const i = (y * W + x) * 4
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  return { index: k, t: k / FPS, rgba, fps: FPS, width: W, height: H }
}

function stream(
  count: number,
  base: Base,
  pan: number,
  flatFrames: readonly number[] = []
): AsyncGenerator<DecodedFrame> {
  return (async function* () {
    for (let k = 0; k < count; k += 1) {
      await Promise.resolve()
      yield frameAt(base, k, pan * k, flatFrames.includes(k))
    }
  })()
}

/** Скорость рамки в долях кадра за секунду при панораме pan px/кадр (игрок стоит на поле). */
const panVelocity = (pan: number): number => (-pan / W) * FPS

const player = (x: number, vx: number, look = 0): StubPattern['players'][number] => ({
  start: { x, y: 0.4, w: 0.02, h: 0.07 },
  velocity: { x: vx, y: 0 },
  look
})

interface Run {
  out: TrackingOutcome
  asks: number
}

async function run(
  pattern: StubPattern,
  frames: AsyncIterable<DecodedFrame>,
  camera: CameraEstimator | undefined,
  anchor: { x: number; y: number }
): Promise<Run> {
  let asks = 0
  const over: Partial<RunTrackingOptions> = camera ? { camera } : {}
  const out = await runTrackingJob({
    from: 0,
    to: 1,
    anchors: [anchor],
    signal: new AbortController().signal,
    frames,
    createDetector: () => Promise.resolve(createStubDetector({ pattern })),
    onAsk: () => {
      asks += 1
      return Promise.resolve(null)
    },
    ...over
  })
  return { out, asks }
}

const FRAMES = 10

/** Слежение сбилось: вопрос, стоп, обрыв отсчётов или отсчёты ушли от настоящего положения игрока (0.91 − PAN·i/W). */
function derails(r: Run): boolean {
  if (r.asks > 0 || r.out.kind !== 'done' || r.out.stop !== null) return true
  const s = r.out.samples[0]
  return s.length < FRAMES || s.some((p, i) => Math.abs(p.foot.x - (0.91 - (PAN * i) / W)) > 0.03)
}
// Якорь — на игроке в первом кадре (рамка w = 0.03, y 0.4..0.54).
const anchorOf = (x: number): { x: number; y: number } => ({ x: x + 0.015, y: 0.47 })

describe('runTrackingJob с движением камеры', () => {
  const base = makeBase(7, W + PAN * FRAMES + 20)

  it('(а) игрок стоит, камера панорамирует: без камеры слежение теряет, с камерой идёт до конца без вопросов', async () => {
    const pattern: StubPattern = { players: [player(0.9, panVelocity(PAN))], cuts: [] }
    const plain = await run(pattern, stream(FRAMES, base, PAN), undefined, anchorOf(0.9))
    expect(derails(plain)).toBe(true)

    const withCam = await run(
      pattern,
      stream(FRAMES, base, PAN),
      new CameraEstimator(),
      anchorOf(0.9)
    )
    expect(withCam.asks).toBe(0)
    expect(withCam.out.kind).toBe('done')
    if (withCam.out.kind !== 'done') return
    expect(withCam.out.stop).toBeNull()
    expect(withCam.out.cameraReliable).toBe(1)
    const s = withCam.out.samples[0]
    expect(s).toHaveLength(FRAMES)
    // Ключи едут по экрану вместе с фоном: каждый кадр на PAN/W левее.
    s.forEach((p, i) => expect(p.foot.x).toBeCloseTo(0.91 - (PAN * i) / W, 2))
  })

  it('(б) два одинаковых игрока рядом, панорама: нет перескока на соседа', async () => {
    const v = panVelocity(PAN)
    // Сосед слева на 24 px (= PAN): без компенсации цель за кадр доезжает до его прежнего места.
    const pattern: StubPattern = {
      players: [player(0.9, v, 0), player(0.85, v, 0)],
      cuts: []
    }
    expect(derails(await run(pattern, stream(FRAMES, base, PAN), undefined, anchorOf(0.9)))).toBe(
      true
    )
    const { out, asks } = await run(
      pattern,
      stream(FRAMES, base, PAN),
      new CameraEstimator(),
      anchorOf(0.9)
    )
    expect(asks).toBe(0)
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.stop).toBeNull()
    const s = out.samples[0]
    expect(s).toHaveLength(FRAMES)
    s.forEach((p, i) => expect(p.foot.x).toBeCloseTo(0.91 - (PAN * i) / W, 2))
  })

  it('(в) камера не передана: прежнее поведение, cameraReliable = 0; на неподвижном фоне камера ничего не меняет', async () => {
    const pattern: StubPattern = { players: [player(0.3, 0.05)], cuts: [] }
    const still = (): AsyncGenerator<DecodedFrame> => stream(FRAMES, base, 0)
    const a = await run(pattern, still(), undefined, anchorOf(0.3))
    const b = await run(pattern, still(), new CameraEstimator(), anchorOf(0.3))
    expect(a.out.kind).toBe('done')
    expect(b.out.kind).toBe('done')
    if (a.out.kind !== 'done' || b.out.kind !== 'done') return
    expect(a.out.cameraReliable).toBe(0)
    expect(b.out.cameraReliable).toBe(1)
    const plain = a.out.samples[0]
    expect(b.out.samples[0]).toHaveLength(plain.length)
    b.out.samples[0].forEach((p, i) => {
      expect(p.foot.x).toBeCloseTo(plain[i].foot.x, 2)
      expect(p.foot.y).toBeCloseTo(plain[i].foot.y, 2)
    })
  })

  it('(г) обрыв оценки посреди долгой панорамы: без скачка, отсчёты на обрыве и после совпадают с запуском без камеры', async () => {
    // Медленная панорама 8 px/кадр: обычный трекер идёт сам. К обрыву (кадры 12, 13) накоплено 96 px: если после обрыва
    // трекер получит рамки в старом пространстве, он увидит скачок на всю накопленную панораму.
    const pan = 8
    const frames = 16
    const slow = makeBase(11, W + pan * frames + 20)
    const pattern: StubPattern = { players: [player(0.9, panVelocity(pan))], cuts: [] }
    const flat = [12, 13]
    const plain = await run(pattern, stream(frames, slow, pan, flat), undefined, anchorOf(0.9))
    const withCam = await run(
      pattern,
      stream(frames, slow, pan, flat),
      new CameraEstimator(),
      anchorOf(0.9)
    )
    expect(plain.out.kind).toBe('done')
    expect(withCam.out.kind).toBe('done')
    if (plain.out.kind !== 'done' || withCam.out.kind !== 'done') return
    expect(plain.asks).toBe(0)
    expect(withCam.asks).toBe(0)
    expect(withCam.out.stop).toBeNull()
    expect(withCam.out.cameraReliable).toBeGreaterThan(0)
    expect(withCam.out.cameraReliable).toBeLessThan(1)
    const a = plain.out.samples[0]
    const b = withCam.out.samples[0]
    expect(b).toHaveLength(a.length)
    expect(b).toHaveLength(frames)
    b.forEach((p, i) => {
      expect(Math.abs(p.foot.x - a[i].foot.x)).toBeLessThan(1e-5)
      expect(Math.abs(p.foot.y - a[i].foot.y)).toBeLessThan(1e-5)
    })
  })

  it('(д) оценка камеры падает на кадре N: задача доходит до конца, push больше не вызывается, ошибка сообщена один раз', async () => {
    const N = 5
    const pattern: StubPattern = { players: [player(0.3, 0.05)], cuts: [] }
    const still = (): AsyncGenerator<DecodedFrame> => stream(FRAMES, base, 0)
    class Throwing extends CameraEstimator {
      calls: number[] = []
      override push(
        ...args: Parameters<CameraEstimator['push']>
      ): ReturnType<CameraEstimator['push']> {
        this.calls.push(args[0].index)
        if (args[0].index === N) throw new Error('сбой оценки')
        return super.push(...args)
      }
    }
    const cam = new Throwing()
    const errors: unknown[] = []
    let asks = 0
    const out = await runTrackingJob({
      from: 0,
      to: 1,
      anchors: [anchorOf(0.3)],
      signal: new AbortController().signal,
      frames: still(),
      createDetector: () => Promise.resolve(createStubDetector({ pattern })),
      onAsk: () => {
        asks += 1
        return Promise.resolve(null)
      },
      camera: cam,
      onCameraError: (e) => errors.push(e)
    })
    const plain = await run(pattern, still(), undefined, anchorOf(0.3))
    expect(out.kind).toBe('done')
    expect(plain.out.kind).toBe('done')
    if (out.kind !== 'done' || plain.out.kind !== 'done') return
    expect(asks).toBe(0)
    expect(errors).toHaveLength(1)
    // Камера работала до N (кадры 0..N), после сбоя не вызывалась.
    expect(cam.calls).toEqual([0, 1, 2, 3, 4, 5])
    expect(cam.chain.between(0, N - 1)).not.toBeNull()
    expect(out.cameraReliable).toBeGreaterThan(0)
    const a = plain.out.samples[0]
    const b = out.samples[0]
    expect(b).toHaveLength(a.length)
    b.forEach((p, i) => {
      expect(Math.abs(p.foot.x - a[i].foot.x)).toBeLessThan(1e-5)
      expect(Math.abs(p.foot.y - a[i].foot.y)).toBeLessThan(1e-5)
    })
  })
})
