// «Качество: Меньше размер» на настоящем ffmpeg: файл заметно меньше при том же числе кадров.
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ExportQuality } from '../../shared/export'
import { FFMPEG, FIXTURE, countFrames, runJob, setTestMode } from './ffmpeg.testkit'

let work: string
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-quality-test-'))
  setTestMode({ name: 'x264', encoder: 'cpu' })
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

async function exportWith(quality: ExportQuality | undefined, name: string): Promise<string> {
  mkdirSync(join(work, name))
  const out = await runJob({
    ffmpegPath: FFMPEG,
    inputPath: FIXTURE('players.mp4'),
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
