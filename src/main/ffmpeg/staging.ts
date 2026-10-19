// Картинки с рисунками, присланные интерфейсом: проверка, запись во временную папку, уборка.
// Не зависит от Electron — вызывается из IPC и напрямую из тестов.
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { OVERLAY_LIMITS, StageOverlaysSchema } from '../../shared/export'
import { parseKey } from '../../shared/exportOverlays'

export const STAGING_PREFIX = 'flow-overlays-'
const STALE_PREFIXES = [STAGING_PREFIX, 'flow-export-']

export const STAGING_ERRORS = {
  bad: 'Не удалось подготовить рисунки для экспорта: некорректные данные',
  notPng: 'Не удалось подготовить рисунки для экспорта: картинка повреждена',
  size: 'Картинка с рисунками не совпадает по размеру с видео',
  tooBig:
    'Слишком большая картинка с рисунками. Уменьшите число рисунков или экспортируйте частями',
  tooMany: 'Слишком много рисунков для одного экспорта. Экспортируйте по частям',
  total: 'Рисунки занимают слишком много памяти. Экспортируйте по частям',
  duplicate: 'Не удалось подготовить рисунки для экспорта: повтор картинки',
  disk: 'Не удалось записать временные файлы. Проверьте свободное место на диске'
} as const

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
// 8 байт подписи + 4 длина + 4 «IHDR» + 4 ширина + 4 высота + 5 прочего + 4 CRC + минимум IEND (12).
const MIN_PNG_BYTES = 8 + 25 + 12

export type PngCheck = { ok: true; width: number; height: number } | { ok: false; error: string }

/** Проверка PNG: подпись, первый блок IHDR, размеры, ширина/высота как у видео, блок IEND в конце. */
export function checkPng(bytes: Uint8Array, expected: { width: number; height: number }): PngCheck {
  if (bytes.length > OVERLAY_LIMITS.maxImageBytes) {
    return { ok: false, error: STAGING_ERRORS.tooBig }
  }
  if (bytes.length < MIN_PNG_BYTES) return { ok: false, error: STAGING_ERRORS.notPng }
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) return { ok: false, error: STAGING_ERRORS.notPng }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ihdrLength = view.getUint32(8)
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (ihdrLength !== 13 || type !== 'IHDR') return { ok: false, error: STAGING_ERRORS.notPng }
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width !== expected.width || height !== expected.height) {
    return { ok: false, error: STAGING_ERRORS.size }
  }
  // Последний блок — IEND (длина 0).
  const end = bytes.length
  const iend = String.fromCharCode(bytes[end - 8], bytes[end - 7], bytes[end - 6], bytes[end - 5])
  if (view.getUint32(end - 12) !== 0 || iend !== 'IEND') {
    return { ok: false, error: STAGING_ERRORS.notPng }
  }
  return { ok: true, width, height }
}

export interface Staged {
  token: string
  dir: string
  width: number
  height: number
  /** Ключ набора рисунков → путь к PNG слоя «поверх всего». */
  files: Map<string, string>
  /** Ключ набора рисунков → путь к PNG слоя «под игроками». */
  underFiles: Map<string, string>
}

export type StageResult = { ok: true; staged: Staged } | { ok: false; error: string }

/** Проверяет присланное целиком и записывает во временную папку. При любой ошибке за собой убирает. */
export async function stageOverlays(
  raw: unknown,
  tempRoot: string = tmpdir()
): Promise<StageResult> {
  const parsed = StageOverlaysSchema.safeParse(raw)
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some(
      (i) => i.code === 'too_big' && i.path.join('.') === 'images'
    )
    return { ok: false, error: tooMany ? STAGING_ERRORS.tooMany : STAGING_ERRORS.bad }
  }
  const { width, height, images } = parsed.data
  let total = 0
  const keys = new Set<string>()
  for (const image of images) {
    if (parseKey(image.key) === null) return { ok: false, error: STAGING_ERRORS.bad }
    const slot = `${image.layer}:${image.key}`
    if (keys.has(slot)) return { ok: false, error: STAGING_ERRORS.duplicate }
    keys.add(slot)
    total += image.data.length
    if (total > OVERLAY_LIMITS.maxTotalBytes) return { ok: false, error: STAGING_ERRORS.total }
    const check = checkPng(image.data, { width, height })
    if (!check.ok) return check
  }

  let dir: string | null = null
  try {
    await mkdir(tempRoot, { recursive: true })
    dir = await mkdtemp(join(tempRoot, STAGING_PREFIX))
    const files = new Map<string, string>()
    const underFiles = new Map<string, string>()
    let n = 0
    for (const image of images) {
      n += 1
      const path = join(dir, `o${String(n).padStart(4, '0')}.png`)
      await writeFile(path, image.data)
      ;(image.layer === 'under' ? underFiles : files).set(image.key, path)
    }
    live.add(dir)
    return { ok: true, staged: { token: randomUUID(), dir, width, height, files, underFiles } }
  } catch {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return { ok: false, error: STAGING_ERRORS.disk }
  }
}

/** Все папки с картинками, которые ещё не удалены: при выходе из приложения убираются синхронно. */
const live = new Set<string>()

// Одна «ожидающая» загрузка: интерфейс присылает картинки, а затем запускает экспорт по билету.
let pending: Staged | null = null

/** Запоминает загрузку; предыдущая, если не была использована, удаляется. */
export async function holdStaged(staged: Staged): Promise<void> {
  const old = pending
  pending = staged
  if (old) await disposeStaged(old)
}

/** Забирает загрузку по билету (она больше не «ожидающая»; удалять её должен вызывающий). */
export function takeStaged(token: string): Staged | null {
  if (!pending || pending.token !== token) return null
  const staged = pending
  pending = null
  return staged
}

export async function disposeStaged(staged: Staged | null): Promise<void> {
  if (!staged) return
  live.delete(staged.dir)
  await rm(staged.dir, { recursive: true, force: true }).catch(() => undefined)
}

/** Выход из приложения: убирает все оставшиеся папки с картинками (синхронно — процесс сейчас завершится). */
export function disposeAllSync(): void {
  pending = null
  for (const dir of live) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* останется до уборки при следующем запуске */
    }
  }
  live.clear()
}

/** Сколько папок с картинками сейчас существует (для тестов). */
export const liveCount = (): number => live.size

/** Папки прошлых запусков, которые не убрались (аварийное завершение): удаляются при старте. */
export async function sweepStale(
  tempRoot: string = tmpdir(),
  olderThanMs = 6 * 3600_000
): Promise<number> {
  let removed = 0
  try {
    for (const name of await readdir(tempRoot)) {
      if (!STALE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
      const path = join(tempRoot, name)
      try {
        const info = await stat(path)
        if (Date.now() - info.mtimeMs < olderThanMs) continue
        await rm(path, { recursive: true, force: true })
        removed += 1
      } catch {
        /* занято или уже удалено */
      }
    }
  } catch {
    /* нет доступа к временной папке */
  }
  return removed
}
