import { describe, expect, it } from 'vitest'
import { runFfmpeg } from './runner'

// Вместо ffmpeg запускаем node: проверяется сам запуск процесса, а не ffmpeg.
const NODE = process.execPath
const node = (code: string): { ffmpegPath: string; args: string[] } => ({
  ffmpegPath: NODE,
  args: ['-e', code]
})

describe('runFfmpeg', () => {
  it('читает ход работы из stdout и хвост stderr', async () => {
    const times: number[] = []
    const r = await runFfmpeg({
      ...node(
        `process.stdout.write('out_time_us=500000\\nprogress=continue\\n');` +
          `for (let i = 1; i <= 40; i++) console.error('строка ' + i); process.exit(3)`
      ),
      onTime: (s) => times.push(s)
    })
    expect(times).toEqual([0.5])
    expect(r.code).toBe(3)
    expect(r.cancelled).toBe(false)
    expect(r.stderrTail).toHaveLength(30)
    expect(r.stderrTail[29]).toBe('строка 40')
    expect(r.stderrTail[0]).toBe('строка 11')
  })

  it('зависший процесс останавливается по таймауту', async () => {
    const started = Date.now()
    const r = await runFfmpeg({ ...node('setTimeout(() => {}, 60000)'), stallMs: 400 })
    expect(r.stalled).toBe(true)
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 15_000)

  it('вывод продлевает ожидание: живой процесс не считается зависшим', async () => {
    const r = await runFfmpeg({
      ...node(
        `let n = 0; const t = setInterval(() => { console.log('x'); if (++n === 6) { clearInterval(t) } }, 150)`
      ),
      stallMs: 4000
    })
    expect(r.stalled).toBe(false)
    expect(r.code).toBe(0)
  }, 15_000)

  it('отмена по сигналу завершает процесс', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const r = await runFfmpeg({
      ...node('setTimeout(() => {}, 60000)'),
      signal: controller.signal
    })
    expect(r.cancelled).toBe(true)
  }, 15_000)

  it('уже отменённый сигнал не оставляет процесс', async () => {
    const controller = new AbortController()
    controller.abort()
    const r = await runFfmpeg({ ...node('setTimeout(() => {}, 60000)'), signal: controller.signal })
    expect(r.cancelled).toBe(true)
  }, 15_000)

  it('несуществующая программа даёт spawnError, а не исключение', async () => {
    const r = await runFfmpeg({ ffmpegPath: 'C:\\нет\\такой\\программы.exe', args: [] })
    expect(r.spawnError).toBeTruthy()
    expect(r.code).toBeNull()
  })
})
