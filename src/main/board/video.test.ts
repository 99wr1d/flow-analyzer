// Видео доски: аргументы ffmpeg, приём кадров, отмена, настоящий ffmpeg (3 одинаковых кадра).
import { existsSync } from 'fs'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blankPng } from '../ffmpeg/blankPng'
import { FFMPEG, durationOf } from '../ffmpeg/ffmpeg.testkit'
import {
  beginBoardVideo,
  boardVideoArgs,
  cancelBoardVideo,
  finishBoardVideo,
  stageBoardFrames
} from './video'

const PNG = new Uint8Array(blankPng(64, 36))
let out: string

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'board-video-test-'))
})
afterEach(async () => {
  cancelBoardVideo()
  await rm(out, { recursive: true, force: true })
})

describe('boardVideoArgs', () => {
  it('частота, шаблон кадров, кодек и выход последним', () => {
    const args = boardVideoArgs('/tmp/f', 30, '/tmp/out.mp4')
    expect(args.slice(0, 5)).toEqual(['-y', '-framerate', '30', '-i', join('/tmp/f', '%05d.png')])
    expect(args).toContain('libx264')
    expect(args).toContain('yuv420p')
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
  })
})

describe('приём кадров', () => {
  it('отвергает не-PNG, пропуск индекса и лишние кадры', async () => {
    const job = await beginBoardVideo({ frameCount: 2, fps: 30, target: join(out, 'a.mp4') })
    await expect(
      stageBoardFrames(job.token, 0, [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])])
    ).rejects.toThrow()
    await expect(stageBoardFrames(job.token, 1, [PNG])).rejects.toThrow()
    await expect(stageBoardFrames(job.token, 0, [PNG, PNG, PNG])).rejects.toThrow()
    await expect(stageBoardFrames('чужой', 0, [PNG])).rejects.toThrow()
    cancelBoardVideo()
  })

  it('второе видео при активном — ошибка', async () => {
    await beginBoardVideo({ frameCount: 1, fps: 30, target: join(out, 'a.mp4') })
    await expect(
      beginBoardVideo({ frameCount: 1, fps: 30, target: join(out, 'b.mp4') })
    ).rejects.toThrow(/уже/)
  })

  it('отмена удаляет временную папку', async () => {
    const job = await beginBoardVideo({ frameCount: 2, fps: 30, target: join(out, 'a.mp4') })
    await stageBoardFrames(job.token, 0, [PNG])
    expect(existsSync(job.dir)).toBe(true)
    cancelBoardVideo(job.token)
    expect(existsSync(job.dir)).toBe(false)
  })

  it('finish без всех кадров — ошибка и папка удалена', async () => {
    const job = await beginBoardVideo({ frameCount: 2, fps: 30, target: join(out, 'a.mp4') })
    await stageBoardFrames(job.token, 0, [PNG])
    await expect(finishBoardVideo(job.token, FFMPEG, () => undefined)).rejects.toThrow()
    expect(existsSync(job.dir)).toBe(false)
  })
})

describe('настоящий ffmpeg', () => {
  it('3 одинаковых кадра дают MP4 ≈ 0.1 с, папка удалена', async () => {
    const target = join(out, 'v.mp4')
    const job = await beginBoardVideo({ frameCount: 3, fps: 30, target })
    await stageBoardFrames(job.token, 0, [PNG, PNG, PNG])
    const res = await finishBoardVideo(job.token, FFMPEG, () => undefined)
    expect(res.path).toBe(target)
    expect(existsSync(target)).toBe(true)
    expect(durationOf(target)).toBeGreaterThan(0.05)
    expect(durationOf(target)).toBeLessThan(0.2)
    expect(existsSync(job.dir)).toBe(false)
    expect((await readdir(out)).sort()).toEqual(['v.mp4'])
  }, 30000)
})
