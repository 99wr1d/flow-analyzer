import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  VIDEO_EXTENSIONS,
  type IpcResult,
  type VideoProbe,
  type VideoSource
} from '../../shared/ipc-contract'
import { probeVideo } from '../media/probe'
import { getMediaEntry, grantVideo } from '../media/registry'
import { MEDIA_ERRORS, checkMediaId } from '../media/validate'
import { isTrustedSender } from '../security'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : MEDIA_ERRORS.unknown
}

export function registerVideoHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.videoOpenDialog,
    async (event): Promise<IpcResult<VideoSource | null>> => {
      try {
        if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
        const parent = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.OpenDialogOptions = {
          title: 'Открыть видео',
          properties: ['openFile'],
          filters: [
            { name: 'Видео', extensions: [...VIDEO_EXTENSIONS] },
            { name: 'Все файлы', extensions: ['*'] }
          ]
        }
        const result = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options)
        if (result.canceled || result.filePaths.length === 0) return { ok: true, data: null }
        return { ok: true, data: await grantVideo(result.filePaths[0]) }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.videoImportPath,
    async (event, path: unknown): Promise<IpcResult<VideoSource>> => {
      try {
        if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
        return { ok: true, data: await grantVideo(path) }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.videoProbe,
    async (event, id: unknown): Promise<IpcResult<VideoProbe>> => {
      try {
        if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
        const problem = checkMediaId(id)
        if (problem) return { ok: false, error: problem }
        const entry = getMediaEntry(id as string)
        if (!entry) return { ok: false, error: MEDIA_ERRORS.unknownId }
        return { ok: true, data: await probeVideo(entry.path) }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
  )
}
