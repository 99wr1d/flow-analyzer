import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { basename, dirname, join } from 'path'
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc-contract'
import { StatsExportSchema, type StatsExportResult } from '../../shared/statsExport'
import { getMediaEntry } from '../media/registry'
import { MEDIA_ERRORS, checkMediaId } from '../media/validate'
import { writeTextAtomic } from '../project/files'
import { isTrustedSender } from '../security'
import { buildStatsCsv, defaultCsvName } from '../stats/csv'

export const STATS_IPC_ERRORS = {
  badRequest: 'Не удалось подготовить статистику к выгрузке: данные некорректны',
  unknown: 'Не удалось сохранить файл'
} as const

/** Файл, созданный последней выгрузкой: только его можно показать в проводнике. */
let lastFile: string | null = null

const ensureCsv = (path: string): string =>
  path.toLowerCase().endsWith('.csv') ? path : `${path}.csv`

async function exportCsv(
  event: Electron.IpcMainInvokeEvent,
  raw: unknown
): Promise<IpcResult<StatsExportResult>> {
  try {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    const parsed = StatsExportSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: STATS_IPC_ERRORS.badRequest }
    const data = parsed.data

    let folder: string | null = null
    if (data.videoId !== null) {
      if (checkMediaId(data.videoId)) return { ok: false, error: MEDIA_ERRORS.unknownId }
      const entry = getMediaEntry(data.videoId)
      if (!entry) return { ok: false, error: MEDIA_ERRORS.unknownId }
      folder = dirname(entry.path)
    }
    const name = defaultCsvName(data.fileStem)
    const options: Electron.SaveDialogOptions = {
      title: 'Выгрузить статистику',
      defaultPath: folder ? join(folder, name) : name,
      filters: [{ name: 'Таблица CSV', extensions: ['csv'] }]
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const picked = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { ok: true, data: { status: 'cancelled' } }

    const target = ensureCsv(picked.filePath)
    await writeTextAtomic(target, buildStatsCsv(data))
    lastFile = target
    return { ok: true, data: { status: 'saved', fileName: basename(target) } }
  } catch (error) {
    // Тексты ошибок записи (нет доступа, нет места) уже понятные.
    const text = error instanceof Error ? error.message : ''
    return { ok: false, error: /[А-Яа-я]/.test(text) ? text : STATS_IPC_ERRORS.unknown }
  }
}

export function registerStatsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.statsExportCsv, exportCsv)
  ipcMain.handle(IPC_CHANNELS.statsReveal, (event): IpcResult<void> => {
    if (!isTrustedSender(event)) return { ok: false, error: MEDIA_ERRORS.untrusted }
    // Показываем только файл, который создала сама выгрузка.
    if (lastFile && existsSync(lastFile)) shell.showItemInFolder(lastFile)
    return { ok: true, data: undefined }
  })
}
