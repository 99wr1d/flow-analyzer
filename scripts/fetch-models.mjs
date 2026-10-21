// Скачивает модель детектора игроков (D-FINE-S, COCO, ONNX) в resources/models и проверяет SHA-256.
// Файл в git не лежит. Скрипт вызывается из postinstall и перед сборкой установщика / автотестами.
// Скачанное только сохраняется и сверяется по хешу — никогда не запускается. Несовпадение хеша — ошибка (код 1).
//
// Для разработки без сети: FLOW_MODEL_SOURCE=<путь к model.onnx> копирует локальный файл (хеш проверяется так же).
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  copyFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const MODELS = [
  {
    file: 'dfine_s_coco.onnx',
    url: 'https://huggingface.co/onnx-community/dfine_s_coco-ONNX/resolve/a3cf03147a9b86c78475139115c8ac142577352d/onnx/model.onnx',
    sha256: 'cd8a49a945feda6d28c6304ae8ae85c2759ba1d78a5a83a22c5ce8db82ef7238',
    size: 41535197
  }
]

export async function sha256Of(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/**
 * Кладёт модель в dir/<file>. Если файл уже есть с верным хешем — ничего не делает.
 * source — путь к локальному файлу вместо скачивания. Возвращает 'present' | 'copied' | 'downloaded'.
 * При несовпадении хеша бросает ошибку и не оставляет файл на месте назначения.
 */
export async function ensureModel(spec, dir, { source, fetchImpl = fetch } = {}) {
  const dest = join(dir, spec.file)
  if (existsSync(dest) && (await sha256Of(dest)) === spec.sha256) return 'present'
  mkdirSync(dir, { recursive: true })
  const part = `${dest}.part`
  rmSync(part, { force: true })
  rmSync(dest, { force: true })
  let how
  try {
    if (source) {
      copyFileSync(source, part)
      how = 'copied'
    } else {
      const res = await fetchImpl(spec.url)
      if (!res.ok || !res.body)
        throw new Error(`Не удалось скачать ${spec.url}: HTTP ${res.status}`)
      await pipeline(Readable.fromWeb(res.body), createWriteStream(part))
      how = 'downloaded'
    }
    const actual = await sha256Of(part)
    if (actual !== spec.sha256) {
      throw new Error(
        `Модель ${spec.file}: SHA-256 не совпал (ожидался ${spec.sha256}, получен ${actual})`
      )
    }
    renameSync(part, dest)
    return how
  } catch (error) {
    rmSync(part, { force: true })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(root, 'resources', 'models')
  try {
    for (const spec of MODELS) {
      const how = await ensureModel(spec, dir, { source: process.env.FLOW_MODEL_SOURCE })
      console.log(
        `Модель ${spec.file}: ${how === 'present' ? 'уже на месте' : how === 'copied' ? 'скопирована' : 'скачана'}`
      )
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
