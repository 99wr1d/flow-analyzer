import { describe, expect, it } from 'vitest'
import { FFMPEG_ERRORS, locateFfmpeg, toUnpackedPath } from './path'

describe('toUnpackedPath', () => {
  it('app.asar → app.asar.unpacked (Windows)', () => {
    expect(
      toUnpackedPath(
        'C:\\Program Files\\FlowAnalyzer\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      )
    ).toBe(
      'C:\\Program Files\\FlowAnalyzer\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    )
  })
  it('app.asar → app.asar.unpacked (слеши вперёд)', () => {
    expect(toUnpackedPath('/opt/x/resources/app.asar/node_modules/ffmpeg-static/ffmpeg')).toBe(
      '/opt/x/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
    )
  })
  it('обычный путь и уже распакованный не меняются', () => {
    const dev = 'C:\\proj\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    expect(toUnpackedPath(dev)).toBe(dev)
    const unpacked = 'C:\\r\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    expect(toUnpackedPath(unpacked)).toBe(unpacked)
  })
  it('не трогает папки, в имени которых случайно есть app.asar', () => {
    const odd = 'C:\\my.app.asar.backup\\node_modules\\ffmpeg.exe'
    expect(toUnpackedPath(odd)).toBe(odd)
  })
})

describe('locateFfmpeg', () => {
  const raw = 'C:\\r\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
  it('возвращает распакованный путь, если файл есть', () => {
    const seen: string[] = []
    const r = locateFfmpeg(raw, (p) => (seen.push(p), true))
    expect(r).toEqual({
      ok: true,
      path: 'C:\\r\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    })
    expect(seen).toEqual([r.ok ? r.path : ''])
  })
  it('понятная ошибка, если файла нет или платформа не поддерживается', () => {
    expect(locateFfmpeg(raw, () => false)).toEqual({ ok: false, error: FFMPEG_ERRORS.missing })
    expect(locateFfmpeg(null)).toEqual({ ok: false, error: FFMPEG_ERRORS.unsupported })
  })
})
