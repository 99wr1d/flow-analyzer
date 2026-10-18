import { describe, expect, it } from 'vitest'
import {
  EXPORT_MESSAGES,
  createProgressParser,
  friendlyFfmpegError,
  parseMediaInfo
} from './progress'

describe('createProgressParser', () => {
  it('читает out_time_us и собирает строки из обрывков', () => {
    const times: number[] = []
    const p = createProgressParser((s) => times.push(s))
    p.feed('frame=10\nout_time_us=400000\nprogress=continue\nframe=20\nout_ti')
    p.feed('me_us=800000\r\nprogress=end\n')
    expect(times).toEqual([0.4, 0.8])
  })
  it('игнорирует N/A и мусор', () => {
    const times: number[] = []
    const p = createProgressParser((s) => times.push(s))
    p.feed('out_time_us=N/A\nout_time_ms=500\nxx\nout_time_us=-5\nout_time_us=1500000\n')
    expect(times).toEqual([1.5])
  })
})

const INFO = `Input #0, mov,mp4, from 'a.mp4':
  Duration: 01:30:05.50, start: 0.000000, bitrate: 477 kb/s
  Stream #0:0[0x1](und): Video: h264 (Main), yuv420p, 640x360, 25 fps
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo
At least one output file must be specified`

describe('parseMediaInfo', () => {
  it('длительность и дорожки', () => {
    expect(parseMediaInfo(INFO)).toEqual({ duration: 5405.5, hasVideo: true, hasAudio: true })
  })
  it('без звука и без длительности', () => {
    const r = parseMediaInfo('  Duration: N/A, start: 0\n  Stream #0:0: Video: vp8, yuv420p')
    expect(r).toEqual({ duration: null, hasVideo: true, hasAudio: false })
  })
  it('обложка не считается видео', () => {
    const r = parseMediaInfo(
      '  Stream #0:0: Audio: mp3\n  Stream #0:1: Video: mjpeg, 300x300 (attached pic)'
    )
    expect(r.hasVideo).toBe(false)
    expect(r.hasAudio).toBe(true)
  })
})

describe('friendlyFfmpegError', () => {
  it('узнаёт частые причины', () => {
    expect(friendlyFfmpegError(['Error writing: No space left on device'])).toBe(
      EXPORT_MESSAGES.noSpace
    )
    expect(friendlyFfmpegError(['x: Permission denied'])).toBe(EXPORT_MESSAGES.noAccess)
    expect(friendlyFfmpegError(['moov atom not found'])).toBe(EXPORT_MESSAGES.badInput)
    expect(friendlyFfmpegError(['Error opening output file x'])).toBe(EXPORT_MESSAGES.cantCreate)
    expect(friendlyFfmpegError(['a.mp4: No such file or directory'])).toBe(
      EXPORT_MESSAGES.inputMissing
    )
    expect(friendlyFfmpegError(['что-то странное'])).toBe(EXPORT_MESSAGES.generic)
  })
})
