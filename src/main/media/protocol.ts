// Протокол flow-media://video/<id>: отдаёт только выданные через реестр файлы, с поддержкой Range.
import { protocol } from 'electron'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import { parseRange } from './range'
import { MEDIA_SCHEME, getMediaEntry } from './registry'
import { mimeForPath } from './validate'

const ID_PATTERN = /^[0-9a-f-]{36}$/

/** Вызывать ДО app.whenReady(). */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      // corsEnabled: видео читается и в WebGL (ключ «газон»), а для этого элемент <video crossorigin> должен получить CORS-ответ.
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ])
}

function plain(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain', ...headers } })
}

export async function handleMediaRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Method Not Allowed')

  let id: string
  try {
    const url = new URL(request.url)
    if (url.hostname !== 'video') return plain(404, 'Not Found')
    id = url.pathname.replace(/^\//, '')
  } catch {
    return plain(404, 'Not Found')
  }
  if (!ID_PATTERN.test(id)) return plain(404, 'Not Found')

  const entry = getMediaEntry(id)
  if (!entry) return plain(404, 'Not Found')

  let size: number
  try {
    const info = await stat(entry.path)
    if (!info.isFile()) return plain(404, 'Not Found')
    size = info.size
  } catch {
    return plain(404, 'Not Found')
  }

  const range = parseRange(request.headers.get('range'), size)
  if (range.kind === 'invalid') {
    return plain(416, 'Range Not Satisfiable', { 'Content-Range': `bytes */${size}` })
  }

  const headers: Record<string, string> = {
    'Content-Type': mimeForPath(entry.path),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    // Отдаём только окну приложения (страница загружена из файла, её «источник» — null); сами файлы выдаёт реестр.
    'Access-Control-Allow-Origin': '*'
  }
  let status = 200
  let start = 0
  let end = size - 1
  if (range.kind === 'partial') {
    status = 206
    start = range.start
    end = range.end
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = String(end - start + 1)

  if (request.method === 'HEAD') return new Response(null, { status, headers })

  const stream = createReadStream(entry.path, { start, end })
  // Если файл исчез/недоступен посреди чтения — не роняем процесс, просто обрываем поток.
  stream.on('error', () => stream.destroy())
  const body = Readable.toWeb(stream) as unknown as ReadableStream
  return new Response(body, { status, headers })
}

/** Вызывать после app.whenReady(). */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) =>
    handleMediaRequest(request).catch(() => plain(500, 'Internal Error'))
  )
}
