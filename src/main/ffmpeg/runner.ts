// Запуск ffmpeg как дочернего процесса: ход работы, отмена с завершением дерева процессов, зависание, хвост ошибок.
import { spawn, type ChildProcess } from 'child_process'
import { createProgressParser } from './progress'

/** Сколько последних строк stderr хранится для подробностей ошибки. */
export const STDERR_TAIL_LINES = 30
/** Если ffmpeg так долго ничего не выводит, считаем, что он завис. */
export const DEFAULT_STALL_MS = 120_000
/** Сколько ждём завершения после обычного kill, прежде чем добивать через taskkill. */
const TASKKILL_DELAY_MS = 1500

export interface RunOptions {
  ffmpegPath: string
  args: string[]
  /** Секунды выходного файла, которые ffmpeg уже записал. */
  onTime?: (seconds: number) => void
  signal?: AbortSignal
  stallMs?: number
}

export interface RunResult {
  code: number | null
  cancelled: boolean
  stalled: boolean
  /** Процесс не запустился (нет файла, нет прав). */
  spawnError?: string
  stderrTail: string[]
  stderr: string
}

/** Завершает процесс и всех его потомков. */
export function killTree(child: ChildProcess): void {
  const pid = child.pid
  child.kill()
  if (process.platform !== 'win32' || !pid) return
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      }).on('error', () => undefined)
    } catch {
      /* процесс уже ушёл */
    }
  }, TASKKILL_DELAY_MS)
  timer.unref()
  child.once('exit', () => clearTimeout(timer))
}

const activeChildren = new Set<ChildProcess>()

/** Останавливает все запущенные ffmpeg (при выходе из приложения). */
export function killAllFfmpeg(): void {
  for (const child of activeChildren) killTree(child)
}

export function runFfmpeg(options: RunOptions): Promise<RunResult> {
  const { ffmpegPath, args, onTime, signal } = options
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS

  return new Promise((resolve) => {
    let cancelled = false
    let stalled = false
    let settled = false
    let tail: string[] = []
    let stderr = ''
    let partial = ''
    let stallTimer: NodeJS.Timeout | undefined

    const finish = (result: Omit<RunResult, 'stderrTail' | 'stderr'>): void => {
      if (settled) return
      settled = true
      clearTimeout(stallTimer)
      signal?.removeEventListener('abort', onAbort)
      if (partial.trim()) tail.push(partial)
      resolve({ ...result, stderrTail: tail.slice(-STDERR_TAIL_LINES), stderr })
    }

    let child: ChildProcess
    try {
      // Аргументы — массив, оболочка не используется: имена файлов не могут превратиться в команды.
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({
        code: null,
        cancelled: false,
        stalled: false,
        spawnError: error instanceof Error ? error.message : String(error),
        stderrTail: [],
        stderr: ''
      })
      return
    }
    activeChildren.add(child)

    const poke = (): void => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        stalled = true
        killTree(child)
      }, stallMs)
    }
    poke()

    function onAbort(): void {
      cancelled = true
      killTree(child)
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    const parser = createProgressParser((s) => onTime?.(s))
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      poke()
      parser.feed(chunk)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      poke()
      if (stderr.length < 200_000) stderr += chunk
      const lines = (partial + chunk).split(/\r?\n/)
      partial = lines.pop() ?? ''
      tail = tail.concat(lines.filter((l) => l.trim() !== '')).slice(-STDERR_TAIL_LINES)
    })

    child.on('error', (error) => {
      activeChildren.delete(child)
      finish({ code: null, cancelled, stalled, spawnError: error.message })
    })
    child.on('close', (code) => {
      activeChildren.delete(child)
      finish({ code, cancelled, stalled })
    })
  })
}
