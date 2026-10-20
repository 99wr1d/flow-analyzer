// Видео, начинающееся позже звука (start_time видео 0.04 с при звуке с 0 — так бывает у фрагментированного MP4):
// «Всё видео целиком» не должно сдвигать картинку относительно звука. Белая вспышка в кадре, «писк» звука в тот же момент.
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Timing } from '../../shared/annotations'
import type { ExportRequest } from '../../shared/export'
import {
  FFMPEG,
  boxPng,
  ff,
  firstLoudSample,
  isWhite,
  MODES,
  runJob,
  setTestMode
} from './ffmpeg.testkit'
import { disposeStaged, stageOverlays } from './staging'

const OFFSET = 0.04
const FLASH_AT = 1 // момент вспышки и «писка» по временной шкале файла = FLASH_AT + OFFSET
let work: string
let source: string

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-start-offset-'))
  source = join(work, 'offset.mp4')
  const wave = `sin(2*PI*1000*t)*between(t,${FLASH_AT + OFFSET},${FLASH_AT + OFFSET + 0.2})`
  const r = ff([
    ...['-f', 'lavfi', '-i', `color=c=black:size=160x90:rate=25:duration=3`],
    ...['-f', 'lavfi', '-i', `aevalsrc='${wave}|${wave}':s=44100:d=3.2`],
    ...[
      '-vf',
      `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,${FLASH_AT * 25})',setpts=PTS+${OFFSET}/TB`
    ],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p'],
    ...['-fps_mode', 'passthrough', '-c:a', 'aac', '-y', source]
  ])
  if (r.status !== 0) throw new Error(r.stderr)
}, 60_000)

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

/** Номера кадров с белым пикселем; кадры не дублируются (иначе ffmpeg сам заполнил бы пропуск в начале). */
function whiteFrames(path: string): number[] {
  const { stdout } = ff([
    '-i',
    path,
    '-fps_mode',
    'passthrough',
    '-vf',
    'crop=2:2:40:40',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    '-'
  ])
  const result: number[] = []
  for (let i = 0; i + 11 < stdout.length; i += 12) {
    if (isWhite([stdout[i], stdout[i + 1], stdout[i + 2]])) result.push(i / 12)
  }
  return result
}

/** Время показа (pts) каждого кадра видео в файле. */
function videoPts(path: string): number[] {
  const { stderr } = ff([
    '-i',
    path,
    '-map',
    '0:v:0',
    '-fps_mode',
    'passthrough',
    '-vf',
    'showinfo',
    '-f',
    'null',
    '-'
  ])
  return [...stderr.matchAll(/pts_time:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
}

/** Время вспышки (по метке кадра) и «писка» (по звуку) в файле, с. */
function flashAndBeep(path: string): { flash: number; beep: number } {
  const white = whiteFrames(path)
  expect(white.length).toBeGreaterThan(0)
  const pts = videoPts(path)
  const beep = firstLoudSample(path) as number
  return { flash: pts[white[0]], beep }
}

let counter = 0
const outDir = (): string => {
  counter += 1
  const dir = join(work, `out-${counter}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const withDrawings = (timings: Timing[]): ExportRequest['drawings'] => ({
  token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
  fps: 25,
  timings,
  loupes: []
})

describe('исходник: видео начинается позже звука', () => {
  it('в самом исходнике вспышка и «писк» совпадают', () => {
    const { flash, beep } = flashAndBeep(source)
    expect(flash).toBeCloseTo(FLASH_AT + OFFSET, 2)
    expect(beep).toBeCloseTo(FLASH_AT + OFFSET, 2)
  })
})

describe.each(MODES)(
  '«Всё видео целиком» не сдвигает картинку относительно звука [$name]',
  (mode) => {
    beforeEach(() => setTestMode(mode))

    for (const kind of [
      'без рисунков',
      'с рисунком',
      'подборка без рисунков',
      'подборка с рисунком'
    ]) {
      it(
        kind,
        async () => {
          const drawn = kind.endsWith('с рисунком')
          const compilation = kind.startsWith('подборка')
          const staged = drawn
            ? await stageOverlays(
                {
                  width: 160,
                  height: 90,
                  images: [
                    {
                      key: '0',
                      layer: 'over',
                      data: boxPng(160, 90, { x0: 0, y0: 0, x1: 4, y1: 4 }, [255, 0, 0])
                    }
                  ]
                },
                work
              )
            : undefined
          if (staged && !staged.ok) throw new Error(staged.error)
          const target = compilation ? join(outDir(), 'c.mp4') : outDir()
          try {
            const out = await runJob({
              ffmpegPath: FFMPEG,
              inputPath: source,
              request: {
                videoId: 'x',
                clips: [{ start: 0, end: 3, label: 'Всё' }],
                mode: compilation ? 'compilation' : 'files',
                precision: 'precise',
                padding: 0,
                projectName: null,
                ...(drawn
                  ? { drawings: withDrawings([{ mode: 'range', start: 2, duration: 0.5 }]) }
                  : {})
              },
              target,
              overlays: staged && staged.ok ? staged.staged : undefined,
              tempRoot: work
            })
            expect(out.result.failures).toEqual([])
            // Картинка остаётся на своём месте (не раньше на кадр), звук тоже (допуск на кодек звука — около 25 мс).
            const { flash, beep } = flashAndBeep(out.paths[0])
            expect(Math.abs(flash - (FLASH_AT + OFFSET))).toBeLessThan(0.01)
            expect(Math.abs(beep - (FLASH_AT + OFFSET))).toBeLessThan(0.03)
          } finally {
            if (staged && staged.ok) await disposeStaged(staged.staged)
          }
        },
        120_000
      )
    }
  }
)
