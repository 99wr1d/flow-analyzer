// Прозрачная картинка нужного размера. Ставится в конец ряда кадров анимации: overlay держит последнюю картинку ряда
// лишь до её метки времени, и без «пустого» кадра в конце последний кадр анимации остался бы без рисунка.
import { crc32, deflateSync } from 'zlib'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { rename, rm, writeFile } from 'fs/promises'

const cache = new Map<string, Buffer>()

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** PNG RGBA width×height, все пиксели прозрачные. */
export function blankPng(width: number, height: number): Buffer {
  const key = `${width}x${height}`
  const hit = cache.get(key)
  if (hit) return hit
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // глубина
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height) // фильтр 0 и нули: прозрачный чёрный
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0))
  ])
  if (cache.size > 4) cache.clear()
  cache.set(key, png)
  return png
}

/**
 * Записывает прозрачную картинку, если файла ещё нет. Куски экспорта идут параллельно и могут просить один и тот же файл:
 * пишем во временный файл и переименовываем, чтобы никто не прочитал недописанную картинку.
 */
export async function writeBlankPng(path: string, width: number, height: number): Promise<void> {
  if (existsSync(path)) return
  const temp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(temp, blankPng(width, height))
    await rename(temp, path)
  } catch (error) {
    // Файл мог появиться между проверкой и переименованием — тогда всё в порядке.
    await rm(temp, { force: true }).catch(() => undefined)
    if (!existsSync(path)) throw error
  }
}
