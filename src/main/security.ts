import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import type { IpcMainInvokeEvent } from 'electron'

const rendererIndexUrl = (): string => pathToFileURL(join(__dirname, '../renderer/index.html')).href

/** Адрес нашего интерфейса: dev-сервер в разработке, файл out/renderer в готовой сборке. */
export function isAppUrl(url: string): boolean {
  try {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) {
      return new URL(url).origin === new URL(devUrl).origin
    }
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    return parsed.href === rendererIndexUrl()
  } catch {
    return false
  }
}

export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  return typeof url === 'string' && isAppUrl(url)
}
