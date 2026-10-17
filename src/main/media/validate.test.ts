import { describe, expect, it } from 'vitest'
import { MAX_PATH_LENGTH, MEDIA_ERRORS, checkVideoPath, mimeForPath } from './validate'

describe('checkVideoPath', () => {
  it('принимает абсолютный путь с видео-расширением', () => {
    expect(checkVideoPath('C:\\Videos\\match.mp4')).toBeNull()
    expect(checkVideoPath('C:\\Videos\\MATCH.MKV')).toBeNull()
    expect(checkVideoPath('C:\\Videos\\a.webm')).toBeNull()
  })
  it('отклоняет не-строки и пустые значения', () => {
    expect(checkVideoPath(undefined)).toBe(MEDIA_ERRORS.badPath)
    expect(checkVideoPath(42)).toBe(MEDIA_ERRORS.badPath)
    expect(checkVideoPath('')).toBe(MEDIA_ERRORS.badPath)
  })
  it('отклоняет относительные пути', () => {
    expect(checkVideoPath('video.mp4')).toBe(MEDIA_ERRORS.badPath)
    expect(checkVideoPath('..\\video.mp4')).toBe(MEDIA_ERRORS.badPath)
  })
  it('отклоняет слишком длинные пути и нулевой символ', () => {
    expect(checkVideoPath('C:\\' + 'a'.repeat(MAX_PATH_LENGTH) + '.mp4')).toBe(MEDIA_ERRORS.badPath)
    expect(checkVideoPath('C:\\a\0.mp4')).toBe(MEDIA_ERRORS.badPath)
  })
  it('отклоняет посторонние расширения', () => {
    expect(checkVideoPath('C:\\Videos\\notes.txt')).toBe(MEDIA_ERRORS.badExtension)
    expect(checkVideoPath('C:\\Videos\\noext')).toBe(MEDIA_ERRORS.badExtension)
  })
})

describe('mimeForPath', () => {
  it('определяет тип по расширению', () => {
    expect(mimeForPath('a.mp4')).toBe('video/mp4')
    expect(mimeForPath('a.mov')).toBe('video/quicktime')
    expect(mimeForPath('a.webm')).toBe('video/webm')
    expect(mimeForPath('a.mkv')).toBe('video/x-matroska')
    expect(mimeForPath('a.xyz')).toBe('application/octet-stream')
  })
})
