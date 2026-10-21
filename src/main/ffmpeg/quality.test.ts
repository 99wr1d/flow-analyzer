// «Качество: Меньше размер» на настоящем ffmpeg: файл заметно меньше при том же числе кадров.
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ExportQuality } from '../../shared/export'
import { MIN_MAXRATE_KBPS } from '../../shared/exportSize'
import { FFMPEG, FIXTURE, MODES, countFrames, ff, runJob, setTestMode } from './ffmpeg.testkit'

let work: string
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-quality-test-'))
  setTestMode({ name: 'x264', encoder: 'cpu' })
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

async function exportWith(
  quality: ExportQuality | undefined,
  name: string,
  input: string = FIXTURE('players.mp4')
): Promise<string> {
  mkdirSync(join(work, name))
  const out = await runJob({
    ffmpegPath: FFMPEG,
    inputPath: input,
    request: {
      videoId: 'x',
      clips: [{ start: 0, end: 3, label: 'a' }],
      mode: 'files',
      precision: 'precise',
      padding: 0,
      projectName: null,
      encoder: 'cpu',
      ...(quality ? { quality } : {})
    },
    target: join(work, name),
    tempRoot: work
  })
  expect(out.result.failures).toEqual([])
  return out.paths[0]
}

describe('качество экспорта', () => {
  it('«Меньше размер» даёт файл меньше обычного, кадров столько же', async () => {
    const normal = await exportWith(undefined, 'normal')
    const small = await exportWith('small', 'small')
    expect(statSync(small).size).toBeLessThan(statSync(normal).size * 0.85)
    expect(countFrames(small)).toBe(countFrames(normal))
  }, 120_000)
})

describe('потолок битрейта относительно исходника', () => {
  /** Шумная картинка (CRF её раздувает), закодированная в маленький битрейт: как запись с трибуны. */
  function makeNoisySource(): string {
    const path = join(work, 'noisy-source.mp4')
    const r = ff([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=25:duration=4,noise=alls=60:allf=t+u',
      '-c:v',
      'libx264',
      '-b:v',
      '500k',
      '-pix_fmt',
      'yuv420p',
      path
    ])
    expect(r.status).toBe(0)
    return path
  }
  const videoKbps = (path: string): number => {
    const r = ff(['-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'])
    const size = /video:(\d+)kB/.exec(r.stderr)
    const dur = /time=(\d+):(\d+):(\d+\.\d+)/.exec(r.stderr)
    const seconds = Number(dur![1]) * 3600 + Number(dur![2]) * 60 + Number(dur![3])
    return (Number(size![1]) * 1024 * 8) / seconds / 1000
  }

  for (const mode of MODES.filter((m) => m.chunkSeconds === undefined)) {
    it(`${mode.name}: файл не раздувается выше потолка (оба качества)`, async () => {
      setTestMode(mode)
      try {
        const source = makeNoisySource()
        const srcKbps = videoKbps(source)
        for (const quality of ['normal', 'small'] as const) {
          const out = await exportWith(quality, `cap-${mode.name}-${quality}`, source)
          const kbps = videoKbps(out)
          const cap = Math.max(MIN_MAXRATE_KBPS, srcKbps * (quality === 'normal' ? 2 : 1.2))
          console.log(
            `${mode.name}, ${quality}: исходник ${srcKbps.toFixed(0)} кбит/с, файл ${kbps.toFixed(0)}, потолок ${cap.toFixed(0)}`
          )
          // Потолок — по средней скорости за буфер; допуск 25 % на короткий клип и разгон кодера.
          expect(kbps).toBeLessThan(cap * 1.25)
        }
      } finally {
        setTestMode({ name: 'x264', encoder: 'cpu' })
      }
    }, 180_000)
  }
})
