// Ключ «газон»: TS-функция (shared/grassKey.ts, её же повторяет шейдер) против самого ffmpeg на синтетических картинках.
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  chromakeyAlpha,
  ffmpegColor,
  grassMask,
  keyUV,
  parseHex,
  rgbToU,
  rgbToV,
  type GrassKeyValues
} from '../../shared/grassKey'
import { FFMPEG, makePng } from './ffmpeg.testkit'
import { grassMaskFilter } from './grassFilter'

let work: string
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-grasskey-test-'))
})
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

function run(args: string[]): Buffer {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  })
  if (r.status !== 0) throw new Error(r.stderr.toString())
  return r.stdout
}

let seed = 99
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

const KEYS: GrassKeyValues[] = [
  { color: '#2a7d3e', similarity: 0.1, blend: 0.05 },
  { color: '#3a9a50', similarity: 0.2, blend: 0.1 },
  { color: '#2f8a3f', similarity: 0.13, blend: 0 },
  { color: '#208040', similarity: 0.05, blend: 0.3 },
  { color: '#6a8f2a', similarity: 0.35, blend: 0.02 }
]

describe('keyUV: цвет ключа', () => {
  it('совпадает с тем, что делает ffmpeg (найдено подбором по результатам chromakey)', () => {
    expect(keyUV('#2a7d3e')).toEqual({ u: 111, v: 92 })
    expect(keyUV('#a74ea1')).toEqual({ u: 154, v: 166 })
    expect(keyUV('#cb3194')).toEqual({ u: 151, v: 197 })
  })
})

describe('chromakeyAlpha против ffmpeg (плоскости U и V)', () => {
  const W = 97 // нечётные размеры: проверяем и края окна 3×3
  const H = 61
  const y = Buffer.alloc(W * H, 110)
  const u = Buffer.alloc(W * H)
  const v = Buffer.alloc(W * H)
  const a = Buffer.alloc(W * H, 255)
  // Шум вокруг зелёного плюс несколько случайных цветов: попадаются и граница, и «внутри», и «снаружи».
  for (let i = 0; i < W * H; i += 1) {
    u[i] = Math.floor(100 + rnd() * 40)
    v[i] = Math.floor(80 + rnd() * 40)
    if (rnd() < 0.2) {
      u[i] = Math.floor(rnd() * 256)
      v[i] = Math.floor(rnd() * 256)
    }
  }
  const input = (): string => {
    const path = join(work, 'uv.yuv')
    writeFileSync(path, Buffer.concat([y, u, v, a]))
    return path
  }

  it.each(KEYS)('ключ %o: ошибка не больше 1/255', (key) => {
    const real = run([
      ...['-f', 'rawvideo', '-pix_fmt', 'yuva444p', '-s', `${W}x${H}`, '-i', input()],
      ...[
        '-vf',
        `chromakey=color=${ffmpegColor(key.color)}:similarity=${key.similarity}:blend=${key.blend},alphaextract`
      ],
      ...['-f', 'rawvideo', '-pix_fmt', 'gray', '-frames:v', '1', '-']
    ])
    const mine = chromakeyAlpha(u, v, W, H, key)
    // Крайний ряд пикселей не сравниваем: окно 3×3 выходит за кадр, и ffmpeg читает там память за плоскостью.
    let max = 0
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        max = Math.max(max, Math.abs(real[y * W + x] - mine[y * W + x]))
      }
    }
    console.log(
      `chromakey ${key.color} s=${key.similarity} b=${key.blend}: макс. ошибка ${max}/255`
    )
    expect(max).toBeLessThanOrEqual(1)
  })
})

describe('grassMask (RGB) против ffmpeg: цепочка, которой пользуется экспорт', () => {
  // Блоки 24×24: трава (светлая и тёмная полосы), белая линия, красная и синяя майки, телесный цвет, тёмная тень.
  const BLOCKS: Array<[string, [number, number, number]]> = [
    ['grass', [46, 139, 69]],
    ['grassLight', [58, 160, 84]],
    ['grassDark', [28, 92, 48]],
    ['line', [240, 243, 238]],
    ['red', [214, 40, 57]],
    ['blue', [29, 78, 216]],
    ['skin', [232, 184, 150]],
    ['yellow', [242, 194, 0]],
    ['shadow', [14, 30, 20]]
  ]
  const B = 24
  const W = BLOCKS.length * B
  const H = B
  const rgba = new Uint8Array(W * H * 4)
  const png = makePng(W, H, (x) => [...BLOCKS[Math.floor(x / B)][1], 255])
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      rgba.set([...BLOCKS[Math.floor(x / B)][1], 255], (y * W + x) * 4)
    }
  }
  const key: GrassKeyValues = { color: '#2e8b45', similarity: 0.07, blend: 0.05 }
  const realMask = (name: string): Buffer => {
    const path = join(work, `${name}.png`)
    writeFileSync(path, png)
    return run([
      ...['-i', path, '-vf', grassMaskFilter(key)],
      ...['-f', 'rawvideo', '-pix_fmt', 'gray', '-frames:v', '1', '-']
    ])
  }

  it('в центрах блоков маска ffmpeg и TS совпадают (±2/255), трава видна, игроки и линия — нет', () => {
    const real = realMask('blocks')
    const mine = grassMask(rgba, W, H, key)
    const report: string[] = []
    BLOCKS.forEach(([name], i) => {
      const x = i * B + B / 2
      const yy = H / 2
      const r = real[yy * W + x]
      const m = mine[yy * W + x]
      report.push(`${name}: ffmpeg ${r}, TS ${m}`)
      expect(Math.abs(r - m), name).toBeLessThanOrEqual(2)
    })
    console.log('маска в центрах блоков: ' + report.join('; '))
    const at = (name: string): number =>
      real[(H / 2) * W + BLOCKS.findIndex(([n]) => n === name) * B + B / 2]
    for (const name of ['grass', 'grassLight', 'grassDark']) expect(at(name)).toBeGreaterThan(250)
    for (const name of ['line', 'red', 'blue', 'skin', 'yellow']) expect(at(name)).toBeLessThan(60)
    // Тёмная тень — зелёная, но очень тёмный цвет теряет цветность: газоном считается лишь частично.
    expect(at('shadow')).toBeLessThan(200)
  })

  it('по всей картинке (с границами блоков и окном 3×3) расхождение не больше 2/255', () => {
    const real = realMask('blocks2')
    const mine = grassMask(rgba, W, H, key)
    let max = 0
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        max = Math.max(max, Math.abs(real[y * W + x] - mine[y * W + x]))
      }
    }
    console.log(`маска по всей картинке (без крайнего ряда): макс. расхождение ${max}/255`)
    expect(max).toBeLessThanOrEqual(2)
  })
})

describe('формулы U и V', () => {
  it('rgbToU/rgbToV совпадают с ffmpeg (полный диапазон) с точностью до единицы', () => {
    const W = 64
    const H = 64
    const rgb = Buffer.alloc(W * H * 3)
    for (let i = 0; i < rgb.length; i += 1) rgb[i] = Math.floor(rnd() * 256)
    const path = join(work, 'rgb.raw')
    writeFileSync(path, rgb)
    for (const [plane, f] of [
      ['u', rgbToU],
      ['v', rgbToV]
    ] as const) {
      const out = run([
        ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', path],
        ...['-vf', `scale=out_range=pc,format=yuva444p,extractplanes=${plane}`],
        ...['-f', 'rawvideo', '-pix_fmt', 'gray', '-frames:v', '1', '-']
      ])
      let max = 0
      for (let i = 0; i < W * H; i += 1) {
        max = Math.max(max, Math.abs(out[i] - f(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])))
      }
      expect(max).toBeLessThanOrEqual(1)
    }
    expect(parseHex('#2a7d3e')).toEqual([42, 125, 62])
  })
})
