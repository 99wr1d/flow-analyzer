// Кадры отрезка из настоящего ffmpeg на синтетических видео. Номер кадра «записан» в пикселях: 8 блоков по 20 px, блок белый,
// если в двоичной записи номера соответствующий разряд равен 1.
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { frameCenter } from '../../shared/annotations'
import { ff, makeLongVideo } from '../ffmpeg/ffmpeg.testkit'
import { decodeFrames, type DecodedFrame } from './frames'

const OFFSET = 0.04
let work: string
let plain: string
let offset: string

const NUMBER = `geq=lum='255*bitand(floor(N/pow(2,floor(X/20))),1)':cb=128:cr=128`

function make(path: string, extra: string[], vf: string): void {
  const r = ff([
    ...['-f', 'lavfi', '-i', 'color=c=black:size=160x90:rate=25:duration=4'],
    ...extra,
    ...['-vf', vf],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p', '-crf', '12'],
    ...['-fps_mode', 'passthrough', '-y', path]
  ])
  if (r.status !== 0) throw new Error(r.stderr)
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-frames-'))
  plain = join(work, 'plain.mp4')
  make(plain, [], NUMBER)
  // Видео начинается позже звука (start_time видео 0.04 при звуке с 0), как в startOffset.test.ts.
  offset = join(work, 'offset.mp4')
  const r = ff([
    ...['-f', 'lavfi', '-i', 'color=c=black:size=160x90:rate=25:duration=4'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4.2'],
    ...['-vf', `${NUMBER},setpts=PTS+${OFFSET}/TB`],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p', '-crf', '12'],
    ...['-fps_mode', 'passthrough', '-c:a', 'aac', '-y', offset]
  ])
  if (r.status !== 0) throw new Error(r.stderr)
}, 60_000)

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

/** Номер кадра, записанный в пикселях картинки (по центру блоков). */
function numberIn(f: DecodedFrame): number {
  let n = 0
  for (let bit = 0; bit < 8; bit += 1) {
    const x = Math.floor(((bit * 20 + 10) / 160) * f.width)
    const y = Math.floor(f.height / 2)
    if (f.rgba[(y * f.width + x) * 4] > 128) n += 2 ** bit
  }
  return n
}

async function collect(
  opts: Partial<Parameters<typeof decodeFrames>[0]> & { videoPath: string }
): Promise<DecodedFrame[]> {
  const out: DecodedFrame[] = []
  for await (const f of decodeFrames({
    from: 2,
    to: 3,
    width: 960,
    signal: new AbortController().signal,
    ...opts
  })) {
    out.push({ ...f, rgba: f.rgba.slice() })
  }
  return out
}

describe('decodeFrames', () => {
  it('кадры с 2.0 по 3.0 с при 25 к/с: ровно 25, номер в пикселях совпадает с index', async () => {
    const frames = await collect({ videoPath: plain })
    expect(frames).toHaveLength(25)
    expect(frames.map((f) => f.index)).toEqual(Array.from({ length: 25 }, (_, i) => 50 + i))
    for (const f of frames) {
      expect(numberIn(f)).toBe(f.index)
      expect(f.t).toBeCloseTo((f.index + 0.5) / 25, 6)
      expect(f.width).toBe(960)
      expect(f.height).toBe(540)
      expect(f.rgba.length).toBe(960 * 540 * 4)
      expect(f.rgba[3]).toBe(255)
    }
  }, 60_000)

  it('другая ширина: высота по пропорциям, чётная', async () => {
    const frames = await collect({ videoPath: plain, width: 321, from: 0, to: 0.1 })
    expect(frames).toHaveLength(3)
    expect(frames[0].width).toBe(321)
    expect(frames[0].height % 2).toBe(0)
    expect(frames[0].height).toBe(180)
    expect(frames[0].rgba.length).toBe(321 * 180 * 4)
  }, 60_000)

  it('видео с start_time 0.04: t совпадает с тем, что показывает плеер', async () => {
    const frames = await collect({ videoPath: offset })
    expect(frames).toHaveLength(25)
    // Кадр с номером N лежит в файле на моменте (N + 1) * 0.04; плеер на этом моменте показывает его, середина слота — frameCenter.
    for (const f of frames) {
      const n = numberIn(f)
      expect(f.t).toBeCloseTo(frameCenter((n + 1) * 0.04, 25), 6)
      expect(f.index).toBe(n + 1)
    }
    expect(frames[0].index).toBe(50)
    expect(numberIn(frames[0])).toBe(49)
  }, 60_000)

  it('abort() посреди: итератор завершается, процесс ffmpeg закрыт', async () => {
    const long = makeLongVideo(work, 20)
    const ctl = new AbortController()
    let pid = 0
    let got = 0
    const started = Date.now()
    for await (const f of decodeFrames({
      videoPath: long,
      from: 0,
      to: 20,
      width: 960,
      signal: ctl.signal,
      onSpawn: (p) => (pid = p)
    })) {
      expect(f.rgba.length).toBe(960 * 540 * 4)
      got += 1
      if (got === 3) ctl.abort()
    }
    expect(got).toBeLessThan(500)
    expect(pid).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(() => process.kill(pid, 0)).toThrow()
  }, 60_000)

  it('abort до старта: ничего не отдаёт', async () => {
    const ctl = new AbortController()
    ctl.abort()
    expect(await collect({ videoPath: plain, signal: ctl.signal })).toEqual([])
  })

  it('прерывание цикла (break) тоже закрывает процесс', async () => {
    let pid = 0
    for await (const f of decodeFrames({
      videoPath: plain,
      from: 0,
      to: 4,
      width: 960,
      signal: new AbortController().signal,
      onSpawn: (p) => (pid = p)
    })) {
      expect(f.index).toBe(0)
      break
    }
    expect(() => process.kill(pid, 0)).toThrow()
  }, 60_000)

  it('нет файла: понятная ошибка', async () => {
    await expect(collect({ videoPath: join(work, 'nope.mp4') })).rejects.toThrow()
  })
})
