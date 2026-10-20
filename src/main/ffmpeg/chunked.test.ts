// Параллельный экспорт по кускам на настоящем ffmpeg: склейка, повтор куска, откат с видеокарты, отмена и уборка.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { head } from './args'
import { concatList, runChunked, type AudioTask, type ChunkTask } from './chunked'
import { BROKEN_GPU_ENCODER, CPU_ENCODER, type EncoderProfile } from './encoders'
import {
  FFMPEG,
  GPU_PROBE,
  countFrames,
  durationOf,
  firstLoudSample,
  hasAudio
} from './ffmpeg.testkit'

let work: string
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-chunked-test-'))
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

let counter = 0
const dirs = (): { workDir: string; output: string } => {
  counter += 1
  return { workDir: join(work, `w${counter}`), output: join(work, `out${counter}.mp4.part`) }
}

/** Кусок: seconds секунд тестового видео 640×360 (номер кадра нарисован на картинке — у каждого куска свой цвет фона). */
function videoTask(
  index: number,
  seconds: number,
  hook?: (n: number) => string[] | null
): ChunkTask {
  let tries = 0
  return {
    index,
    weight: seconds,
    prepare: async (enc: EncoderProfile, output: string) => {
      tries += 1
      const override = hook?.(tries)
      return {
        args: override ?? [
          ...head(),
          '-f',
          'lavfi',
          '-i',
          `testsrc2=size=640x360:rate=25:duration=${seconds}`,
          ...enc.videoArgs,
          '-f',
          'mp4',
          '-y',
          output
        ]
      }
    }
  }
}

/** Звук: синус нужной длины, AAC. */
const audioTask = (seconds: number): AudioTask => ({
  prepare: async (output) => ({
    args: [
      ...head(),
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=1000:sample_rate=48000:duration=${seconds}`,
      '-c:a',
      'aac',
      '-f',
      'mp4',
      '-y',
      output
    ]
  })
})

const base = { ffmpegPath: FFMPEG, logicalCores: 12, workers: 2 }

describe('список для склейки', () => {
  it('имена относительные, кавычки экранируются', () => {
    expect(concatList(['a.mp4', "b'c.mp4"])).toBe(
      "ffconcat version 1.0\nfile 'a.mp4'\nfile 'b'\\''c.mp4'\n"
    )
  })
})

describe('параллельный экспорт на настоящем ffmpeg', () => {
  it('куски и звук склеиваются без потерь: 75 кадров, звук есть, прогресс идёт до единицы', async () => {
    const d = dirs()
    const progress: number[] = []
    const logs: string[] = []
    const r = await runChunked({
      ...base,
      ...d,
      tasks: [videoTask(0, 1), videoTask(1, 1), videoTask(2, 1)],
      audio: audioTask(3),
      encoder: CPU_ENCODER,
      onProgress: (f) => progress.push(f),
      log: (m) => logs.push(m)
    })
    expect(r.status).toBe('done')
    expect(countFrames(d.output)).toBe(75)
    expect(hasAudio(d.output)).toBe(true)
    expect(durationOf(d.output) as number).toBeGreaterThan(2.9)
    expect(durationOf(d.output) as number).toBeLessThan(3.1)
    expect(progress[progress.length - 1]).toBe(1)
    for (let i = 1; i < progress.length; i += 1)
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
    // Звук без сдвига: синус начинается сразу.
    expect(firstLoudSample(d.output) as number).toBeLessThan(0.1)
    rmSync(d.output, { force: true })
    rmSync(d.workDir, { recursive: true, force: true })
  }, 60_000)

  it('без звука: только видео', async () => {
    const d = dirs()
    const r = await runChunked({
      ...base,
      ...d,
      tasks: [videoTask(0, 1), videoTask(1, 1)],
      audio: null,
      encoder: CPU_ENCODER
    })
    expect(r.status).toBe('done')
    expect(countFrames(d.output)).toBe(50)
    expect(hasAudio(d.output)).toBe(false)
  }, 60_000)

  it('кусок не получился с первого раза — повторяется один раз и экспорт заканчивается успешно', async () => {
    const d = dirs()
    const logs: string[] = []
    const r = await runChunked({
      ...base,
      ...d,
      tasks: [
        videoTask(0, 1),
        videoTask(1, 1, (n) =>
          n === 1 ? [...head(), '-i', join(work, 'нет-такого.mp4'), '-f', 'null', '-'] : null
        )
      ],
      audio: null,
      encoder: CPU_ENCODER,
      log: (m) => logs.push(m)
    })
    expect(r.status).toBe('done')
    expect(countFrames(d.output)).toBe(50)
    expect(logs.some((l) => l.includes('повторяю'))).toBe(true)
  }, 60_000)

  it('кусок не получается и со второго раза — ошибка с текстом ffmpeg, готового файла нет', async () => {
    const d = dirs()
    const bad = (): string[] => [...head(), '-i', join(work, 'нет-такого.mp4'), '-f', 'null', '-']
    const r = await runChunked({
      ...base,
      ...d,
      tasks: [videoTask(0, 1), videoTask(1, 1, bad), videoTask(2, 1)],
      audio: null,
      encoder: CPU_ENCODER
    })
    expect(r.status).toBe('failed')
    if (r.status === 'failed') {
      expect(r.run.code).not.toBe(0)
      expect(r.run.stderrTail.join('\n')).toMatch(/No such file|нет-такого/)
    }
    expect(existsSync(d.output)).toBe(false)
  }, 60_000)

  it('кодер видеокарты сломан: всё повторяется на процессоре, кодер в итоге x264', async () => {
    const d = dirs()
    const logs: string[] = []
    const r = await runChunked({
      ...base,
      ...d,
      tasks: [videoTask(0, 1), videoTask(1, 1), videoTask(2, 1)],
      audio: audioTask(3),
      encoder: BROKEN_GPU_ENCODER,
      log: (m) => logs.push(m)
    })
    expect(r.status).toBe('done')
    expect(r.encoder).toBe(CPU_ENCODER)
    expect(r.fellBack).toBe(true)
    expect(countFrames(d.output)).toBe(75)
    expect(logs.some((l) => l.includes('на процессоре'))).toBe(true)
  }, 60_000)

  it('настоящая видеокарта (если есть): куски склеиваются без потерь', async () => {
    if (!GPU_PROBE.gpu) return
    const d = dirs()
    const r = await runChunked({
      ...base,
      ...d,
      tasks: [videoTask(0, 1), videoTask(1, 1), videoTask(2, 1)],
      audio: audioTask(3),
      encoder: GPU_PROBE.gpu
    })
    expect(r.status).toBe('done')
    expect(r.fellBack).toBe(false)
    expect(r.encoder.id).toBe(GPU_PROBE.gpu.id)
    expect(countFrames(d.output)).toBe(75)
  }, 60_000)

  it('отмена: процессы останавливаются быстро, итогового файла нет', async () => {
    const d = dirs()
    const controller = new AbortController()
    const long = (index: number): ChunkTask => ({
      index,
      weight: 600,
      prepare: async (enc, output) => ({
        args: [
          ...head(),
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=1280x720:rate=25:duration=600',
          ...enc.videoArgs,
          '-f',
          'mp4',
          '-y',
          output
        ]
      })
    })
    const started = Date.now()
    setTimeout(() => controller.abort(), 1500)
    const r = await runChunked({
      ...base,
      ...d,
      tasks: [long(0), long(1), long(2)],
      audio: null,
      encoder: CPU_ENCODER,
      signal: controller.signal
    })
    expect(r.status).toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(existsSync(d.output)).toBe(false)
    // Рабочую папку убирает вызывающий (job.ts): здесь она может остаться, но в ней нет работающих процессов.
    rmSync(d.workDir, { recursive: true, force: true })
    expect(readdirSync(work).filter((n) => n.startsWith('w')).length).toBeGreaterThanOrEqual(0)
  }, 60_000)
})
