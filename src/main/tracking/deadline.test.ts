import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './deadline'

afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('ответ вовремя проходит, таймер снят', async () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const p = withTimeout<number>(
      1000,
      'долго',
      (resolve) => setTimeout(() => resolve(7), 10),
      onTimeout
    )
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toBe(7)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('нет ответа за срок: отказ с понятной ошибкой и вызов onTimeout', async () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const p = withTimeout<number>(
      1000,
      'Детектор не ответил за отведённое время',
      () => undefined,
      onTimeout
    )
    const caught = p.catch((e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await caught).toBe('Детектор не ответил за отведённое время')
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('ошибка до срока передаётся как есть', async () => {
    vi.useFakeTimers()
    const p = withTimeout<number>(1000, 'долго', (_ok, fail) => fail(new Error('сбой')))
    await expect(p).rejects.toThrow('сбой')
  })
})
