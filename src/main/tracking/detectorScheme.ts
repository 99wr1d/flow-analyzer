// Окно-детектор грузится не с file://, а по схеме flow-detector://app/…: только так страница получает заголовки
// Cross-Origin-Opener-Policy / Embedder-Policy и становится crossOriginIsolated (нужно onnxruntime-web для потоков WASM).
// Схема обслуживается ТОЛЬКО сессией окна-детектора; основное окно SharedArrayBuffer не получает.
import type { Session } from 'electron'
import { readFile } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'

export const DETECTOR_SCHEME = 'flow-detector'
export const DETECTOR_PARTITION = 'flow-detector'
export const DETECTOR_URL = `${DETECTOR_SCHEME}://app/detector.html`

/** Для registerSchemesAsPrivileged (вызывается до готовности приложения, вместе с остальными схемами). */
export const DETECTOR_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: DETECTOR_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true }
}

export const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin'
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json'
}

/** Путь файла внутри корня сборки или null (выход за корень запрещён). */
export function resolveDetectorAsset(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const base = resolve(root)
  const full = resolve(base, '.' + decoded)
  return full.startsWith(base + sep) ? full : null
}

export function serveDetectorScheme(session: Session, root: string): void {
  session.protocol.handle(DETECTOR_SCHEME, async (request) => {
    const fail = (status: number): Response =>
      new Response(String(status), { status, headers: ISOLATION_HEADERS })
    if (request.method !== 'GET') return fail(405)
    const url = new URL(request.url)
    if (url.hostname !== 'app') return fail(404)
    const file = resolveDetectorAsset(root, url.pathname)
    const type = file ? MIME[extname(file).toLowerCase()] : undefined
    if (!file || !type) return fail(404)
    try {
      return new Response(new Uint8Array(await readFile(file)), {
        headers: { ...ISOLATION_HEADERS, 'Content-Type': type }
      })
    } catch {
      return fail(404)
    }
  })
}

/** В разработке страница идёт с dev-сервера: изоляцию даём заголовками ответа (только в сессии детектора). */
export function isolateDevServer(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    for (const [k, v] of Object.entries(ISOLATION_HEADERS)) headers[k] = [v]
    callback({ responseHeaders: headers })
  })
}

export const detectorRoot = (dirname: string): string => join(dirname, '../renderer')
