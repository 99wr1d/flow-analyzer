import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseTestFlags } from './testFlags'

const ISOLATED = { FLOW_USER_DATA: resolve('flow-test-data') }

describe('тестовые флаги экспорта', () => {
  it('у обычного пользователя (папка данных не задана) всё выключено, что бы ни стояло в окружении', () => {
    const f = parseTestFlags({ FLOW_TEST_GPU_FAIL: '1', FLOW_EXPORT_CHUNK_SEC: '1' })
    expect(f.gpuFail).toBe(false)
    expect(f.exportChunkSeconds).toBeNull()
  })
  it('в тестовом запуске флаги работают', () => {
    const f = parseTestFlags({ ...ISOLATED, FLOW_TEST_GPU_FAIL: '1', FLOW_EXPORT_CHUNK_SEC: '2.5' })
    expect(f.gpuFail).toBe(true)
    expect(f.exportChunkSeconds).toBe(2.5)
  })
  it('длина куска: только число от полсекунды до десяти минут', () => {
    for (const bad of ['abc', '', '0', '0.4', '601', '-1', 'NaN']) {
      expect(
        parseTestFlags({ ...ISOLATED, FLOW_EXPORT_CHUNK_SEC: bad }).exportChunkSeconds
      ).toBeNull()
    }
    expect(parseTestFlags({ ...ISOLATED, FLOW_EXPORT_CHUNK_SEC: '600' }).exportChunkSeconds).toBe(
      600
    )
    expect(parseTestFlags({ ...ISOLATED }).exportChunkSeconds).toBeNull()
  })
})
