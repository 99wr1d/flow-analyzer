import { describe, expect, it, vi } from 'vitest'
import {
  beginVideoJob,
  cancelCurrentVideoJob,
  currentVideoJob,
  endVideoJob,
  isCurrentVideoJob
} from './videoJob'

describe('сохранение видео: отмена своего задания', () => {
  it('отмена прерывает текущее и передаёт его token', () => {
    const job = beginVideoJob('a')
    const cancel = vi.fn()
    expect(cancelCurrentVideoJob(cancel)).toBe(true)
    expect(job.abort.signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledWith('a')
    expect(endVideoJob(job)).toBe(true)
    expect(currentVideoJob()).toBeNull()
  })

  it('завершение старого задания не сбрасывает новое: «Отмена» нового работает', () => {
    const old = beginVideoJob('old')
    const next = beginVideoJob('new')
    expect(endVideoJob(old)).toBe(false)
    expect(isCurrentVideoJob(next)).toBe(true)
    const cancel = vi.fn()
    expect(cancelCurrentVideoJob(cancel)).toBe(true)
    expect(cancel).toHaveBeenCalledWith('new')
    expect(next.abort.signal.aborted).toBe(true)
    expect(old.abort.signal.aborted).toBe(false)
    endVideoJob(next)
  })

  it('без задания отменять нечего', () => {
    const cancel = vi.fn()
    expect(cancelCurrentVideoJob(cancel)).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })
})
