import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MODELS, ensureModel } from './fetch-models.mjs'

const bytes = Buffer.from('not really a model')
const good = createHash('sha256').update(bytes).digest('hex')
const spec = (sha256) => ({
  file: 'm.onnx',
  url: 'https://example.invalid/m',
  sha256,
  size: bytes.length
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'flow-models-'))
  const src = join(dir, 'src.bin')
  writeFileSync(src, bytes)
  return { dir, src, out: join(dir, 'out') }
}

describe('fetch-models', () => {
  it('закреплённая модель описана хешем и адресом по коммиту', () => {
    expect(MODELS[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(MODELS[0].url).toContain('a3cf03147a9b86c78475139115c8ac142577352d')
  })

  it('неверный SHA-256 — ошибка, файла на месте нет', async () => {
    const { dir, src, out } = setup()
    await expect(ensureModel(spec('0'.repeat(64)), out, { source: src })).rejects.toThrow(/SHA-256/)
    expect(existsSync(join(out, 'm.onnx'))).toBe(false)
    expect(existsSync(join(out, 'm.onnx.part'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('верный хеш — копирует; повторный запуск ничего не качает', async () => {
    const { dir, src, out } = setup()
    expect(await ensureModel(spec(good), out, { source: src })).toBe('copied')
    expect(readFileSync(join(out, 'm.onnx')).equals(bytes)).toBe(true)
    const noNetwork = () => Promise.reject(new Error('сеть не нужна'))
    expect(await ensureModel(spec(good), out, { fetchImpl: noNetwork })).toBe('present')
    rmSync(dir, { recursive: true, force: true })
  })

  it('битый файл на месте заменяется; скачивание проверяется по хешу', async () => {
    const { dir, out } = setup()
    writeFileSync(join(dir, 'x'), 'x')
    const fetchOk = () => Promise.resolve(new Response(bytes))
    expect(await ensureModel(spec(good), out, { fetchImpl: fetchOk })).toBe('downloaded')
    writeFileSync(join(out, 'm.onnx'), 'испорчен')
    expect(await ensureModel(spec(good), out, { fetchImpl: fetchOk })).toBe('downloaded')
    const fetchBad = () => Promise.resolve(new Response('подмена'))
    await expect(ensureModel(spec('1'.repeat(64)), out, { fetchImpl: fetchBad })).rejects.toThrow(
      /SHA-256/
    )
    rmSync(dir, { recursive: true, force: true })
  })
})
