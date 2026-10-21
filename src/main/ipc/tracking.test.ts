// IPC слежения без Electron: ipcMain и webContents подменены, сама задача (runTrackingJob) — управляемая заглушка.
// Проверяется жизненный цикл: отмена, уход страницы (перезагрузка, падение, закрытие), вопрос без ответа, чужие ffmpeg.
import { EventEmitter } from 'events'
import { resolve } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunTrackingOptions, TrackingOutcome } from '../tracking/job'

const handlers = new Map<string, (event: unknown, raw?: unknown) => unknown>()
const killAll = vi.fn()
let impl: (o: RunTrackingOptions) => Promise<TrackingOutcome>

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, raw?: unknown) => unknown) => handlers.set(ch, fn)
  }
}))
vi.mock('../security', () => ({ isTrustedSender: () => true }))
vi.mock('../ffmpeg/path', () => ({ getFfmpegPath: () => ({ ok: true, path: 'ffmpeg' }) }))
vi.mock('../ffmpeg/runner', () => ({ killAllFfmpeg: () => killAll() }))
vi.mock('../log/logger', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('../media/probe', () => ({
  probeVideo: () => Promise.resolve({ fps: 25, variable: false })
}))
vi.mock('../media/registry', () => ({
  getMediaEntry: () => ({ path: resolve('tests/fixtures/players.mp4') })
}))
vi.mock('../testFlags', () => ({
  testFlags: () => ({ detectorStub: true, detectorStubPattern: null, detectorStubDelayMs: 0 })
}))
vi.mock('../tracking/detectorWindow', () => ({ createDetector: vi.fn() }))
vi.mock('../tracking/frames', () => ({
  exactFps: (f: number) => f,
  decodeFrames: () =>
    (async function* () {
      yield* []
    })()
}))
vi.mock('../tracking/job', () => ({ runTrackingJob: (o: RunTrackingOptions) => impl(o) }))

import { cancelActiveTracking, registerTrackingHandlers } from './tracking'

const VIDEO_ID = '11111111-2222-4333-8444-555555555555'
const request = { videoId: VIDEO_ID, from: 0, to: 3, anchor: { x: 0.3, y: 0.5 } }

class FakeSender extends EventEmitter {
  sent: Array<{ channel: string; payload: Record<string, unknown> }> = []
  isDestroyed = (): boolean => false
  send(channel: string, payload: Record<string, unknown>): void {
    this.sent.push({ channel, payload })
  }
  done = (): unknown[] => this.sent.filter((s) => s.channel === 'tracking:done')
}

const call = async (
  channel: string,
  sender: FakeSender,
  raw?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
  (await handlers.get(channel)!({ sender }, raw)) as { ok: boolean; data?: unknown; error?: string }

/** Задача висит, пока её не отменят. */
const untilAborted = (o: RunTrackingOptions): Promise<TrackingOutcome> =>
  new Promise((res) => {
    const finish = (): void => res({ kind: 'cancelled' })
    if (o.signal.aborted) finish()
    else o.signal.addEventListener('abort', finish, { once: true })
  })

const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function start(sender: FakeSender): Promise<string> {
  const r = await call('tracking:start', sender, request)
  expect(r.ok).toBe(true)
  return (r.data as { jobId: string }).jobId
}

beforeEach(async () => {
  impl = untilAborted
  await cancelActiveTracking()
  handlers.clear()
  killAll.mockClear()
  impl = untilAborted
  registerTrackingHandlers()
})

describe('IPC слежения', () => {
  it('отмена: итога нет, чужие ffmpeg не трогаются, место свободно', async () => {
    const sender = new FakeSender()
    const jobId = await start(sender)
    expect((await call('tracking:start', sender, request)).error).toMatch(/уже идёт/)
    expect((await call('tracking:cancel', sender, { jobId })).ok).toBe(true)
    expect(killAll).not.toHaveBeenCalled()
    expect(sender.done()).toHaveLength(0)
    await start(sender)
    await call('tracking:cancel', sender, { jobId: 'другая' })
  })

  it('перезагрузка страницы (тот же webContents): задача отменена, новая принимается', async () => {
    const sender = new FakeSender()
    await start(sender)
    // переход внутри страницы (якорь) задачу не трогает
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    await tick()
    expect((await call('tracking:start', sender, request)).error).toMatch(/уже идёт/)
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    await tick()
    expect(sender.done()).toHaveLength(0)
    expect(killAll).not.toHaveBeenCalled()
    const second = await call('tracking:start', sender, request)
    expect(second.ok).toBe(true)
    sender.emit('render-process-gone')
    await tick()
    expect((await call('tracking:start', sender, request)).ok).toBe(true)
    sender.emit('destroyed')
  })

  it('вопрос без ответа: уход страницы завершает ожидание, слушатели сняты', async () => {
    const sender = new FakeSender()
    let asked: Promise<number | null> | null = null
    impl = async (o) => {
      asked = o.onAsk(1, [{ x: 0, y: 0, w: 0.1, h: 0.2 }])
      const index = await asked
      return index === null
        ? { kind: 'cancelled' }
        : { kind: 'done', samples: [], stop: null, backend: 'wasm' }
    }
    await start(sender)
    await tick()
    expect(sender.sent.some((s) => s.channel === 'tracking:ask')).toBe(true)
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    await expect(asked).resolves.toBeNull()
    await tick()
    expect(sender.done()).toHaveLength(0)
    expect(sender.listenerCount('did-start-navigation')).toBe(0)
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
    expect((await call('tracking:start', sender, request)).ok).toBe(true)
  })

  it('ответ на вопрос: неверный индекс отклоняется, верный доходит до задачи', async () => {
    const sender = new FakeSender()
    let answer: number | null = -1
    impl = async (o) => {
      answer = await o.onAsk(1, [
        { x: 0, y: 0, w: 0.1, h: 0.2 },
        { x: 0.5, y: 0, w: 0.1, h: 0.2 }
      ])
      return { kind: 'done', samples: [], stop: null, backend: 'wasm' }
    }
    const jobId = await start(sender)
    await tick()
    expect((await call('tracking:resolve', sender, { jobId, index: 2 })).ok).toBe(false)
    expect((await call('tracking:resolve', sender, { jobId: 'x', index: 0 })).ok).toBe(false)
    expect((await call('tracking:resolve', sender, { jobId, index: 1 })).ok).toBe(true)
    await tick()
    expect(answer).toBe(1)
    expect(sender.done()).toHaveLength(1)
  })

  it('сбой задачи приходит итогом failed', async () => {
    const sender = new FakeSender()
    impl = () => Promise.reject(new Error('сломалось'))
    await start(sender)
    await tick()
    expect(sender.done()[0]).toMatchObject({
      payload: { error: 'failed', message: 'сломалось' }
    })
  })
})
