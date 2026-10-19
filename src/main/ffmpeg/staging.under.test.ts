// Картинки с рисунками: слой «под игроками» (этап 16a) проверяется и записывается так же, как слой «поверх всего».
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ExportRequestSchema, OVERLAY_LIMITS, StageOverlaysSchema } from '../../shared/export'
import { makePng } from './ffmpeg.testkit'
import { STAGING_ERRORS, disposeAllSync, disposeStaged, stageOverlays } from './staging'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'flow-staging-under-'))
})
afterAll(() => {
  disposeAllSync()
  rmSync(root, { recursive: true, force: true })
})

const W = 32
const H = 18
const png = (): Uint8Array => makePng(W, H)

describe('слои картинок', () => {
  it('поле layer необязательно: старые запросы — «поверх всего»', () => {
    const parsed = StageOverlaysSchema.parse({
      width: W,
      height: H,
      images: [{ key: '0', data: png() }]
    })
    expect(parsed.images[0].layer).toBe('over')
    expect(
      StageOverlaysSchema.safeParse({
        width: W,
        height: H,
        images: [{ key: '0', data: png(), layer: 'middle' }]
      }).success
    ).toBe(false)
  })

  it('«поверх» и «под игроками» одного набора рисунков лежат в разных списках', async () => {
    const res = await stageOverlays(
      {
        width: W,
        height: H,
        images: [
          { key: '0-1', data: png(), layer: 'over' },
          { key: '0-1', data: png(), layer: 'under' },
          { key: '2', data: png(), layer: 'under' }
        ]
      },
      root
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { files, underFiles } = res.staged
    expect([...files.keys()]).toEqual(['0-1'])
    expect([...underFiles.keys()]).toEqual(['0-1', '2'])
    for (const p of [...files.values(), ...underFiles.values()]) expect(existsSync(p)).toBe(true)
    expect(files.get('0-1')).not.toBe(underFiles.get('0-1'))
    await disposeStaged(res.staged)
    expect(existsSync(res.staged.dir)).toBe(false)
  })

  it('повтор картинки в том же слое — ошибка; картинка под игроками проверяется на размер', async () => {
    const dup = await stageOverlays(
      {
        width: W,
        height: H,
        images: [
          { key: '0', data: png(), layer: 'under' },
          { key: '0', data: png(), layer: 'under' }
        ]
      },
      root
    )
    expect(dup).toEqual({ ok: false, error: STAGING_ERRORS.duplicate })
    const wrong = await stageOverlays(
      {
        width: W,
        height: H,
        images: [{ key: '0', data: makePng(W + 2, H), layer: 'under' }]
      },
      root
    )
    expect(wrong).toEqual({ ok: false, error: STAGING_ERRORS.size })
  })

  it('до 300 наборов по две картинки помещаются в лимит запроса', () => {
    expect(OVERLAY_LIMITS.maxKeys).toBe(300)
    expect(OVERLAY_LIMITS.maxImages).toBe(2 * OVERLAY_LIMITS.maxKeys)
  })
})

describe('запрос экспорта с ключом газона', () => {
  const base = {
    videoId: 'v',
    clips: [{ start: 0, end: 5, label: 'Гол' }],
    mode: 'files',
    precision: 'precise',
    padding: 0,
    projectName: null
  }
  const drawings = {
    token: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
    fps: 25,
    timings: [{ mode: 'range', start: 0, duration: 2 }]
  }

  it('grass необязателен, но проверяется', () => {
    const ok = ExportRequestSchema.safeParse({ ...base, drawings })
    expect(ok.success).toBe(true)
    const good = ExportRequestSchema.safeParse({
      ...base,
      drawings: { ...drawings, grass: { color: '#2a7d3e', similarity: 0.07, blend: 0.05 } }
    })
    expect(good.success).toBe(true)
    for (const grass of [
      { color: 'зелёный', similarity: 0.07, blend: 0.05 },
      { color: '#2a7d3e', similarity: 0.9, blend: 0.05 },
      { color: '#2a7d3e', similarity: 0.07, blend: 1 },
      { color: '#2a7d3e', similarity: 0.07 }
    ]) {
      expect(
        ExportRequestSchema.safeParse({ ...base, drawings: { ...drawings, grass } }).success
      ).toBe(false)
    }
  })
})
