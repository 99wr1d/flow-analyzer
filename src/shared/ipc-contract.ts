// Единый контракт IPC между main, preload и renderer.
// Здесь только имена каналов, типы и константы — никакой логики.

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  videoOpenDialog: 'video:open-dialog',
  videoImportPath: 'video:import-path',
  videoProbe: 'video:probe'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

/** Видеофайл, к которому приложение выдало доступ. Адрес url работает только пока приложение запущено. */
export interface VideoSource {
  id: string
  fileName: string
  sizeBytes: number
  url: string
}

/** Что удалось узнать о файле из его метаданных. fps = null — контейнер не прочитан или частоты нет. */
export interface VideoProbe {
  fps: number | null
  /** Частота кадров переменная: fps — среднее значение. */
  variable: boolean
  frameCount?: number
}

/** Расширения, которые можно импортировать (без точки). */
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'] as const

/** Результат любого IPC-вызова: либо данные, либо понятная ошибка. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Полное описание API, которое preload отдаёт в window.api. */
export interface FlowApi {
  getAppInfo(): Promise<AppInfo>
  /** Показывает системный диалог выбора файла. null — пользователь отменил выбор. */
  openVideoDialog(): Promise<VideoSource | null>
  /** Принимает файл, перетащенный в окно. */
  importDroppedVideo(file: File): Promise<VideoSource>
  /** Метаданные ранее выданного видео (по id, не по пути). */
  probeVideo(id: string): Promise<VideoProbe>
}
