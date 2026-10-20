import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { blankPng, writeBlankPng } from './blankPng'
import { checkPng } from './staging'
import { ff } from './ffmpeg.testkit'

let work: string
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'flow-blank-test-'))
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

describe('прозрачная картинка для конца ряда кадров', () => {
  it('настоящий PNG нужного размера: проверка main принимает его', () => {
    const png = blankPng(320, 180)
    expect(checkPng(new Uint8Array(png), { width: 320, height: 180 })).toEqual({
      ok: true,
      width: 320,
      height: 180
    })
    expect(checkPng(new Uint8Array(png), { width: 640, height: 360 }).ok).toBe(false)
  })
  it('ffmpeg читает её и все пиксели прозрачные', () => {
    const path = join(work, 'a.png')
    return writeBlankPng(path, 64, 36).then(() => {
      const r = ff(['-i', path, '-vf', 'format=rgba', '-f', 'rawvideo', '-'])
      expect(r.status).toBe(0)
      expect(r.stdout.length).toBe(64 * 36 * 4)
      for (let i = 3; i < r.stdout.length; i += 4) expect(r.stdout[i]).toBe(0)
    })
  })
  it('несколько одновременных записей одного файла дают один целый файл без временных остатков', async () => {
    const path = join(work, 'b.png')
    await Promise.all(Array.from({ length: 8 }, () => writeBlankPng(path, 128, 72)))
    expect(readFileSync(path).equals(blankPng(128, 72))).toBe(true)
    expect(readdirSync(work).filter((n) => n.startsWith('b.png'))).toEqual(['b.png'])
  })
  it('повторная запись существующего файла ничего не меняет', async () => {
    const path = join(work, 'c.png')
    await writeBlankPng(path, 32, 18)
    const before = readFileSync(path)
    await writeBlankPng(path, 32, 18)
    expect(readFileSync(path).equals(before)).toBe(true)
  })
})
