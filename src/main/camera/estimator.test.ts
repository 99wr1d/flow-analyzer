import { describe, expect, it } from 'vitest'
import { applyH } from '../../shared/pitch/homography'
import type { DecodedFrame } from '../tracking/frames'
import { CameraEstimator } from './estimator'
import { toGray } from './gray'

const W = 480
const H = 270
const BW = 700

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

/** Широкая текстура-подложка (мелкий + крупный шум). */
function makeBase(seed: number): Float32Array {
  const rand = rng(seed)
  const fine = blur(blur(new Float32Array(BW * H).map(() => rand() * 255), BW, H, 1), BW, H, 1)
  const coarse = blur(blur(new Float32Array(BW * H).map(() => rand() * 255), BW, H, 4), BW, H, 4)
  return fine.map((f, i) => 128 + (f - 128) * 2.2 + (coarse[i] - 128) * 4)
}

/** Кадр с индексом index: окно подложки сдвинуто на shift px вправо (содержимое уезжает влево). */
function frame(base: Float32Array, index: number, shift: number, seed: number): DecodedFrame {
  const rand = rng(seed)
  const rgba = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const v = Math.max(0, Math.min(255, Math.round(base[y * BW + x + shift] + rand() * 4 - 2)))
      const i = (y * W + x) * 4
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  return { index, t: index / 25 + 0.02, rgba, fps: 25, width: W, height: H }
}

describe('toGray', () => {
  it('серый кадр шириной ≤ 480 не меняется по размеру и значениям', () => {
    const f = frame(makeBase(1), 0, 0, 1)
    const g = toGray(f)
    expect(g.width).toBe(W)
    expect(g.height).toBe(H)
    expect(g.data[5 * W + 7]).toBe(f.rgba[(5 * W + 7) * 4])
  })

  it('уменьшает 960×540 до 480×270 усреднением блоков', () => {
    const rgba = new Uint8Array(960 * 540 * 4)
    for (let i = 0; i < rgba.length; i += 4) {
      const v = (i / 4) % 2 === 0 ? 100 : 200
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v
    }
    const g = toGray({ index: 0, t: 0, rgba, fps: 25, width: 960, height: 540 })
    expect(g.width).toBe(480)
    expect(g.height).toBe(270)
    expect(g.data[10]).toBe(150)
  })

  it('веса яркости: белый = 255, зелёный светлее синего', () => {
    const mk = (r: number, g: number, b: number): number =>
      toGray(
        { index: 0, t: 0, rgba: new Uint8Array([r, g, b, 255]), fps: 25, width: 1, height: 1 },
        1
      ).data[0]
    expect(mk(255, 255, 255)).toBe(255)
    expect(mk(0, 255, 0)).toBeGreaterThan(mk(0, 0, 255))
  })
})

describe('CameraEstimator', () => {
  const base = makeBase(5)

  it('панорама 3 px/кадр: за 9 шагов накопление ≈ 27 px (в пределах 1 px)', () => {
    const est = new CameraEstimator()
    for (let k = 0; k < 10; k += 1) {
      const m = est.push(frame(base, k, 3 * k, 100 + k), [], false)
      if (k === 0) expect(m).toBeNull()
      else expect(m?.reliable).toBe(true)
    }
    const M = est.chain.between(0, 9)
    expect(M).not.toBeNull()
    const p = applyH(M!, { x: 0.5, y: 0.5 })!
    expect(Math.abs((p.x - 0.5) * W + 27)).toBeLessThan(1)
    expect(Math.abs((p.y - 0.5) * W)).toBeLessThan(1)
  })

  it('смена плана (cut) рвёт цепочку, участки по обе стороны целы', () => {
    const est = new CameraEstimator()
    const other = makeBase(9)
    for (let k = 0; k < 10; k += 1) {
      const f = k >= 5 ? frame(other, k, 3 * k, 200 + k) : frame(base, k, 3 * k, 100 + k)
      const m = est.push(f, [], k === 5)
      if (k === 5) expect(m).toBeNull()
    }
    expect(est.chain.between(4, 6)).toBeNull()
    expect(est.chain.between(0, 4)).not.toBeNull()
    expect(est.chain.between(5, 9)).not.toBeNull()
  })

  it('ненадёжная оценка кладёт в цепочку кадр с reliable:false', () => {
    const est = new CameraEstimator()
    est.push(frame(base, 0, 0, 1), [], false)
    const flat = frame(base, 1, 0, 2)
    flat.rgba.fill(128)
    const m = est.push(flat, [], false)
    expect(m?.reliable).toBe(false)
    expect(est.chain.between(0, 1)).toBeNull()
  })
})
