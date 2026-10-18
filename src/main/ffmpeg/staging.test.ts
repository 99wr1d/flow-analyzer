import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ExportRequestSchema, OVERLAY_LIMITS } from '../../shared/export'
import { makePng } from './ffmpeg.testkit'
import {
  STAGING_ERRORS,
  STAGING_PREFIX,
  checkPng,
  disposeAllSync,
  disposeStaged,
  holdStaged,
  liveCount,
  stageOverlays,
  sweepStale,
  takeStaged
} from './staging'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'flow-staging-test-'))
})
afterAll(() => {
  disposeAllSync()
  rmSync(root, { recursive: true, force: true })
})

const W = 32
const H = 18
const png = (w = W, h = H): Uint8Array => makePng(w, h)

describe('checkPng', () => {
  it('корректный PNG нужного размера', () => {
    expect(checkPng(png(), { width: W, height: H })).toEqual({ ok: true, width: W, height: H })
  })
  it('не PNG: пустые данные, другой формат, обрезанный файл', () => {
    const bad = STAGING_ERRORS.notPng
    expect(checkPng(new Uint8Array(0), { width: W, height: H })).toEqual({ ok: false, error: bad })
    expect(
      checkPng(new TextEncoder().encode('GIF89a'.repeat(30)), { width: W, height: H })
    ).toEqual({
      ok: false,
      error: bad
    })
    const cut = png().slice(0, 40)
    expect(checkPng(cut, { width: W, height: H })).toEqual({ ok: false, error: bad })
    // Подпись верна, но первый блок не IHDR.
    const broken = png().slice()
    broken[12] = 0x58
    expect(checkPng(broken, { width: W, height: H })).toEqual({ ok: false, error: bad })
    // Нет IEND в конце.
    const noEnd = png().slice()
    noEnd[noEnd.length - 6] = 0x58
    expect(checkPng(noEnd, { width: W, height: H })).toEqual({ ok: false, error: bad })
  })
  it('размеры из IHDR должны совпасть с видео', () => {
    expect(checkPng(png(64, 36), { width: W, height: H })).toEqual({
      ok: false,
      error: STAGING_ERRORS.size
    })
    expect(checkPng(png(W, H + 1), { width: W, height: H }).ok).toBe(false)
  })
  it('слишком большая картинка отклоняется', () => {
    const big = new Uint8Array(OVERLAY_LIMITS.maxImageBytes + 1)
    expect(checkPng(big, { width: W, height: H })).toEqual({
      ok: false,
      error: STAGING_ERRORS.tooBig
    })
  })
})

describe('stageOverlays', () => {
  it('записывает картинки во временную папку и выдаёт билет', async () => {
    const res = await stageOverlays(
      {
        width: W,
        height: H,
        images: [
          { key: '0', data: png() },
          { key: '1-2', data: png() }
        ]
      },
      root
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.staged.dir.startsWith(join(root, STAGING_PREFIX))).toBe(true)
    expect(readdirSync(res.staged.dir).sort()).toEqual(['o0001.png', 'o0002.png'])
    expect(res.staged.files.get('1-2')).toBe(join(res.staged.dir, 'o0002.png'))
    expect(liveCount()).toBeGreaterThan(0)
    await disposeStaged(res.staged)
    expect(existsSync(res.staged.dir)).toBe(false)
  })

  it('ожидающая загрузка: забрать по билету можно один раз, неверный билет — null', async () => {
    const res = await stageOverlays(
      { width: W, height: H, images: [{ key: '0', data: png() }] },
      root
    )
    if (!res.ok) throw new Error(res.error)
    await holdStaged(res.staged)
    expect(takeStaged('другой-билет')).toBeNull()
    expect(takeStaged(res.staged.token)).toBe(res.staged)
    expect(takeStaged(res.staged.token)).toBeNull()
    await disposeStaged(res.staged)
  })

  it('новая загрузка вытесняет и удаляет прежнюю, невостребованную', async () => {
    const a = await stageOverlays(
      { width: W, height: H, images: [{ key: '0', data: png() }] },
      root
    )
    const b = await stageOverlays(
      { width: W, height: H, images: [{ key: '0', data: png() }] },
      root
    )
    if (!a.ok || !b.ok) throw new Error('stage')
    await holdStaged(a.staged)
    await holdStaged(b.staged)
    expect(existsSync(a.staged.dir)).toBe(false)
    expect(existsSync(b.staged.dir)).toBe(true)
    disposeAllSync()
    expect(existsSync(b.staged.dir)).toBe(false)
    expect(liveCount()).toBe(0)
  })

  it('плохие данные отклоняются понятной ошибкой и ничего не оставляют на диске', async () => {
    const before = readdirSync(root).length
    const cases: Array<[unknown, string]> = [
      [null, STAGING_ERRORS.bad],
      [{ width: W, height: H, images: [] }, STAGING_ERRORS.bad],
      [{ width: 5, height: H, images: [{ key: '0', data: png() }] }, STAGING_ERRORS.bad],
      [{ width: W, height: H, images: [{ key: '../x', data: png() }] }, STAGING_ERRORS.bad],
      [{ width: W, height: H, images: [{ key: '0', data: 'строка' }] }, STAGING_ERRORS.bad],
      [
        { width: W, height: H, images: [{ key: '0', data: new Uint8Array(100) }] },
        STAGING_ERRORS.notPng
      ],
      [{ width: W, height: H, images: [{ key: '0', data: png(64, 36) }] }, STAGING_ERRORS.size],
      [
        {
          width: W,
          height: H,
          images: [
            { key: '0', data: png() },
            { key: '0', data: png() }
          ]
        },
        STAGING_ERRORS.duplicate
      ]
    ]
    for (const [raw, error] of cases) {
      expect(await stageOverlays(raw, root)).toEqual({ ok: false, error })
    }
    expect(readdirSync(root).length).toBe(before)
  })

  it('больше 300 картинок — отказ', async () => {
    const images = Array.from({ length: OVERLAY_LIMITS.maxImages + 1 }, (_, i) => ({
      key: String(i),
      data: png()
    }))
    expect(await stageOverlays({ width: W, height: H, images }, root)).toEqual({
      ok: false,
      error: STAGING_ERRORS.tooMany
    })
  })

  it('общий размер больше предела — отказ (до записи на диск)', async () => {
    // Крупные «картинки» с верной шапкой: проверяется сумма, а не содержимое.
    const base = png()
    const make = (): Uint8Array => {
      const data = new Uint8Array(OVERLAY_LIMITS.maxImageBytes)
      data.set(base.subarray(0, base.length - 12))
      data.set(base.subarray(base.length - 12), data.length - 12)
      return data
    }
    const images = Array.from({ length: 40 }, (_, i) => ({ key: String(i), data: make() }))
    const res = await stageOverlays({ width: W, height: H, images }, root)
    expect(res).toEqual({ ok: false, error: STAGING_ERRORS.total })
  })

  it('работает в папке с кириллицей и пробелом', async () => {
    const dir = join(root, 'папка с пробелом')
    mkdirSync(dir)
    const res = await stageOverlays(
      { width: W, height: H, images: [{ key: '0', data: png() }] },
      dir
    )
    expect(res.ok).toBe(true)
    if (res.ok) await disposeStaged(res.staged)
  })
})

describe('sweepStale', () => {
  it('удаляет только старые папки с нашим префиксом', async () => {
    const dir = join(root, 'sweep')
    mkdirSync(dir)
    const old = join(dir, `${STAGING_PREFIX}old`)
    const fresh = join(dir, `${STAGING_PREFIX}fresh`)
    const other = join(dir, 'чужая-папка')
    for (const p of [old, fresh, other]) mkdirSync(p)
    const past = new Date(Date.now() - 24 * 3600_000)
    utimesSync(old, past, past)
    utimesSync(other, past, past)
    expect(await sweepStale(dir)).toBe(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })
})

describe('запрос экспорта с рисунками (схема)', () => {
  const base = {
    videoId: 'x',
    clips: [{ start: 1, end: 2, label: 'a' }],
    mode: 'files',
    precision: 'precise',
    padding: 0,
    projectName: null
  }
  const drawings = {
    token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
    fps: 25,
    timings: [
      { mode: 'range', start: 1, duration: 2 },
      { mode: 'frame', start: 2.02 }
    ]
  }
  it('принимает рисунки; у «кадра» без freezeSeconds подставляется 3', () => {
    const r = ExportRequestSchema.safeParse({ ...base, drawings })
    expect(r.success).toBe(true)
    if (r.success && r.data.drawings?.timings[1].mode === 'frame') {
      expect(r.data.drawings.timings[1].freezeSeconds).toBe(3)
    }
  })
  it('отклоняет плохой билет, частоту и время показа', () => {
    expect(
      ExportRequestSchema.safeParse({ ...base, drawings: { ...drawings, token: 'x' } }).success
    ).toBe(false)
    expect(
      ExportRequestSchema.safeParse({ ...base, drawings: { ...drawings, fps: 0 } }).success
    ).toBe(false)
    expect(
      ExportRequestSchema.safeParse({
        ...base,
        drawings: { ...drawings, timings: [{ mode: 'frame', start: 1, freezeSeconds: 99 }] }
      }).success
    ).toBe(false)
  })
  it('запрос без рисунков по-прежнему допустим', () => {
    expect(ExportRequestSchema.safeParse(base).success).toBe(true)
  })
})
