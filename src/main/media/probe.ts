// Определение частоты кадров по метаданным контейнера.
//
// Сейчас читаем MP4/M4V/MOV сами (moov → trak → mdia → mdhd + stts + stsz): это даёт точную частоту
// без внешних программ. Единственная точка входа — probeVideo(path): позже её можно заменить на ffprobe,
// не трогая остальной код (IPC, интерфейс).
import { open } from 'fs/promises'
import type { VideoProbe } from '../../shared/ipc-contract'
import { extensionOf } from './validate'

const MP4_EXTENSIONS = ['mp4', 'm4v', 'mov']
/** moov больше этого размера не читаем (защита от битых или злонамеренных файлов). */
const MAX_MOOV_BYTES = 64 * 1024 * 1024

/** Фрагментированный MP4: сколько фрагментов и какого размера читаем. */
const MAX_FRAGMENTS = 100_000
const MAX_MOOF_BYTES = 4 * 1024 * 1024

const NO_INFO: VideoProbe = { fps: null, variable: false }

export interface SttsEntry {
  count: number
  delta: number
}

/** Считает частоту по таблице длительностей кадров (stts). Чистая функция. */
export function fpsFromStts(entries: SttsEntry[], timescale: number): VideoProbe {
  let frames = 0
  let ticks = 0
  for (const e of entries) {
    frames += e.count
    ticks += e.count * e.delta
  }
  if (frames <= 0 || ticks <= 0 || timescale <= 0) return NO_INFO

  // Последний кадр часто имеет другую длительность — на «переменность» это не влияет.
  const body =
    entries.length > 1 && entries[entries.length - 1].count === 1 ? entries.slice(0, -1) : entries
  const deltas = new Set(body.map((e) => e.delta))
  const variable = deltas.size > 1

  const fps = variable
    ? (frames * timescale) / ticks
    : // Постоянная частота: берём длительность кадра напрямую — получаем ровно 25, 30000/1001 и т.д.
      timescale / body[0].delta
  if (!Number.isFinite(fps) || fps <= 0 || fps > 1000) return NO_INFO
  return { fps, variable, frameCount: frames }
}

interface Box {
  type: string
  /** Начало содержимого (после заголовка). */
  start: number
  end: number
}

function* boxesIn(buf: Buffer, start: number, end: number): Generator<Box> {
  let pos = start
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    let header = 8
    if (size === 1) {
      if (pos + 16 > end) return
      const big = buf.readBigUInt64BE(pos + 8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return
      size = Number(big)
      header = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (size < header || pos + size > end) return
    yield { type, start: pos + header, end: pos + size }
    pos += size
  }
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  for (const box of boxesIn(buf, parent.start, parent.end)) if (box.type === type) return box
  return undefined
}

function parseMdhdTimescale(buf: Buffer, box: Box): number | null {
  if (box.end - box.start < 24) return null
  const version = buf[box.start]
  const offset = box.start + (version === 1 ? 20 : 12)
  if (offset + 4 > box.end) return null
  return buf.readUInt32BE(offset)
}

function parseStts(buf: Buffer, box: Box): SttsEntry[] | null {
  if (box.end - box.start < 8) return null
  const count = buf.readUInt32BE(box.start + 4)
  if (count === 0 || box.start + 8 + count * 8 > box.end) return null
  const entries: SttsEntry[] = []
  for (let i = 0; i < count; i++) {
    const at = box.start + 8 + i * 8
    entries.push({ count: buf.readUInt32BE(at), delta: buf.readUInt32BE(at + 4) })
  }
  return entries
}

interface VideoTrack {
  trackId: number
  timescale: number
  samples: SttsEntry[]
  /** trex.default_sample_duration — для фрагментированного MP4. */
  defaultDuration: number
}

function parseTrackId(buf: Buffer, trak: Box): number | null {
  const tkhd = child(buf, trak, 'tkhd')
  if (!tkhd) return null
  const offset = tkhd.start + (buf[tkhd.start] === 1 ? 20 : 12)
  return offset + 4 <= tkhd.end ? buf.readUInt32BE(offset) : null
}

function parseTrexDefaults(buf: Buffer, moov: Box): Map<number, number> {
  const result = new Map<number, number>()
  const mvex = child(buf, moov, 'mvex')
  if (!mvex) return result
  for (const trex of boxesIn(buf, mvex.start, mvex.end)) {
    // version/flags(4), track_ID(4), default_sample_description_index(4), default_sample_duration(4)
    if (trex.type === 'trex' && trex.end - trex.start >= 16) {
      result.set(buf.readUInt32BE(trex.start + 4), buf.readUInt32BE(trex.start + 12))
    }
  }
  return result
}

/** Находит первую видеодорожку в moov. */
function findVideoTrack(buf: Buffer): VideoTrack | null {
  const root: Box = { type: 'root', start: 0, end: buf.length }
  const moov = child(buf, root, 'moov')
  if (!moov) return null
  const trex = parseTrexDefaults(buf, moov)

  for (const trak of boxesIn(buf, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue
    const mdia = child(buf, trak, 'mdia')
    const hdlr = mdia && child(buf, mdia, 'hdlr')
    if (!mdia || !hdlr || hdlr.end - hdlr.start < 12) continue
    if (buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue

    const mdhd = child(buf, mdia, 'mdhd')
    const minf = child(buf, mdia, 'minf')
    const stbl = minf && child(buf, minf, 'stbl')
    const stts = stbl && child(buf, stbl, 'stts')
    const trackId = parseTrackId(buf, trak)
    if (!mdhd || trackId === null) return null

    const timescale = parseMdhdTimescale(buf, mdhd)
    if (!timescale) return null
    return {
      trackId,
      timescale,
      samples: (stts && parseStts(buf, stts)) || [],
      defaultDuration: trex.get(trackId) ?? 0
    }
  }
  return null
}

/** Длительности кадров из одного фрагмента (moof) для дорожки trackId. */
function fragmentSamples(buf: Buffer, trackId: number, defaultDuration: number): SttsEntry[] {
  const out: SttsEntry[] = []
  const root: Box = { type: 'root', start: 0, end: buf.length }
  const moof = child(buf, root, 'moof')
  if (!moof) return out

  for (const traf of boxesIn(buf, moof.start, moof.end)) {
    if (traf.type !== 'traf') continue
    const tfhd = child(buf, traf, 'tfhd')
    if (!tfhd || tfhd.end - tfhd.start < 8) continue
    if (buf.readUInt32BE(tfhd.start + 4) !== trackId) continue

    const tfFlags = buf.readUIntBE(tfhd.start + 1, 3)
    let at = tfhd.start + 8
    if (tfFlags & 0x1) at += 8
    if (tfFlags & 0x2) at += 4
    let duration = defaultDuration
    if (tfFlags & 0x8) {
      if (at + 4 > tfhd.end) continue
      duration = buf.readUInt32BE(at)
    }

    for (const trun of boxesIn(buf, traf.start, traf.end)) {
      if (trun.type !== 'trun' || trun.end - trun.start < 8) continue
      const flags = buf.readUIntBE(trun.start + 1, 3)
      const count = buf.readUInt32BE(trun.start + 4)
      let p = trun.start + 8
      if (flags & 0x1) p += 4
      if (flags & 0x4) p += 4
      const perSample = 4 * [0x100, 0x200, 0x400, 0x800].filter((bit) => flags & bit).length
      const hasDuration = (flags & 0x100) !== 0
      if (p + count * perSample > trun.end) continue
      for (let i = 0; i < count; i++) {
        const d = hasDuration ? buf.readUInt32BE(p + i * perSample) : duration
        const last = out[out.length - 1]
        if (last && last.delta === d) last.count += 1
        else out.push({ count: 1, delta: d })
      }
    }
  }
  return out
}

function appendRuns(target: SttsEntry[], runs: SttsEntry[]): void {
  for (const run of runs) {
    const last = target[target.length - 1]
    if (last && last.delta === run.delta) last.count += run.count
    else target.push({ ...run })
  }
}

/** Разбирает moov (и при необходимости фрагменты moof) и возвращает результат для первой видеодорожки. */
export function probeBoxes(moov: Buffer, moofs: Buffer[] = []): VideoProbe {
  const track = findVideoTrack(moov)
  if (!track) return NO_INFO
  const samples = track.samples
  if (samples.length === 0) {
    for (const moof of moofs) {
      appendRuns(samples, fragmentSamples(moof, track.trackId, track.defaultDuration))
    }
  }
  return fpsFromStts(samples, track.timescale)
}

interface TopLevelBox {
  type: string
  pos: number
  size: number
}

async function readTopLevel(
  file: Awaited<ReturnType<typeof open>>,
  total: number,
  onBox: (box: TopLevelBox) => Promise<boolean>
): Promise<void> {
  const head = Buffer.alloc(16)
  let pos = 0
  while (pos + 8 <= total) {
    const { bytesRead } = await file.read(head, 0, 16, pos)
    if (bytesRead < 8) return
    let size = head.readUInt32BE(0)
    const type = head.toString('latin1', 4, 8)
    let header = 8
    if (size === 1) {
      if (bytesRead < 16) return
      size = Number(head.readBigUInt64BE(8))
      header = 16
    } else if (size === 0) {
      size = total - pos
    }
    if (!Number.isSafeInteger(size) || size < header) return
    size = Math.min(size, total - pos)
    if ((await onBox({ type, pos, size })) === false) return
    pos += size
  }
}

async function readBytes(
  file: Awaited<ReturnType<typeof open>>,
  pos: number,
  size: number
): Promise<Buffer | null> {
  const buf = Buffer.alloc(size)
  const { bytesRead } = await file.read(buf, 0, size, pos)
  return bytesRead === size ? buf : null
}

/**
 * Узнаёт частоту кадров видеофайла. Никогда не бросает из-за «не удалось разобрать»:
 * в таком случае fps = null, и интерфейс оценит частоту сам.
 */
export async function probeVideo(path: string): Promise<VideoProbe> {
  if (!MP4_EXTENSIONS.includes(extensionOf(path))) return NO_INFO
  let file
  try {
    file = await open(path, 'r')
    const { size: total } = await file.stat()
    let moov: Buffer | null = null
    const moofs: Buffer[] = []
    let moofBytes = 0
    const handle = file
    await readTopLevel(handle, total, async (box) => {
      if (box.type === 'moov' && box.size <= MAX_MOOV_BYTES) {
        moov = await readBytes(handle, box.pos, box.size)
      } else if (
        box.type === 'moof' &&
        moofs.length < MAX_FRAGMENTS &&
        box.size <= MAX_MOOF_BYTES
      ) {
        const buf = await readBytes(handle, box.pos, box.size)
        if (buf) {
          moofs.push(buf)
          moofBytes += buf.length
        }
        if (moofBytes > MAX_MOOV_BYTES) return false
      }
      return true
    })
    return moov ? probeBoxes(moov, moofs) : NO_INFO
  } catch {
    return NO_INFO
  } finally {
    await file?.close()
  }
}
