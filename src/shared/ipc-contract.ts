// Единый контракт IPC между main, preload и renderer.
// Здесь только имена каналов, типы и константы — никакой логики.
import type {
  ProjectOpenResult,
  ProjectSaveRequest,
  ProjectSaveResult,
  RecentProject,
  RecoveryItem
} from './project'
import type { Settings, SettingsLoadResult } from './settings'

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  videoOpenDialog: 'video:open-dialog',
  videoImportPath: 'video:import-path',
  videoProbe: 'video:probe',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  projectSave: 'project:save',
  projectOpen: 'project:open',
  projectRecent: 'project:recent',
  projectRelinkVideo: 'project:relink-video',
  projectAutosave: 'project:autosave',
  projectRecoveryList: 'project:recovery-list',
  projectRecoveryRestore: 'project:recovery-restore',
  projectRecoveryDiscard: 'project:recovery-discard',
  projectClearRecovery: 'project:clear-recovery',
  projectTakeLaunchPath: 'project:take-launch-path',
  windowSetTitle: 'window:set-title',
  appCloseResponse: 'app:close-response',
  appConfirmClose: 'app:confirm-close',
  appCancelClose: 'app:cancel-close'
} as const

/** События, которые main отправляет интерфейсу. */
export const IPC_EVENTS = {
  closeRequested: 'app:close-requested',
  openProjectRequested: 'project:open-requested'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  /** Как часто интерфейс присылает автосохранение (мс). */
  autosaveMs: number
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
  /** Настройки приложения. Повреждённый файл заменяется стандартными настройками, о чём говорит warning. */
  getSettings(): Promise<SettingsLoadResult>
  /** Проверяет и сохраняет настройки; возвращает то, что реально записано. */
  saveSettings(settings: Settings): Promise<Settings>

  /** Сохраняет проект. saveAs или отсутствие пути — спросит файл. */
  saveProject(request: ProjectSaveRequest, saveAs: boolean): Promise<ProjectSaveResult>
  /** path = null — диалог выбора файла; иначе путь из списка недавних или присланный самим приложением. */
  openProject(path: string | null): Promise<ProjectOpenResult>
  /** Диалог «Указать видео» для проекта, у которого видео не нашлось (ticket из результата открытия). */
  relinkProjectVideo(ticket: string): Promise<ProjectOpenResult>
  listRecentProjects(): Promise<RecentProject[]>
  /** Копия работы на случай сбоя (не заменяет сохранение). */
  autosaveProject(request: ProjectSaveRequest): Promise<void>
  listRecovery(): Promise<RecoveryItem[]>
  restoreRecovery(key: string): Promise<ProjectOpenResult>
  discardRecovery(key: string): Promise<void>
  /** Удаляет копию работы проекта с этим путём (null — безымянного). */
  clearRecovery(path: string | null): Promise<void>
  /** Проект, переданный в командной строке при запуске (выдаётся один раз). */
  takeLaunchProject(): Promise<string | null>
  /** Заголовок окна задаёт main: name = null — просто «FlowAnalyzer». */
  setWindowTitle(name: string | null, dirty: boolean): Promise<void>
  /** Окно пытаются закрыть: интерфейс отвечает respondClose, а при несохранённой работе спрашивает пользователя. */
  onCloseRequested(callback: () => void): () => void
  respondClose(dirty: boolean): Promise<void>
  confirmClose(): Promise<void>
  cancelClose(): Promise<void>
  /** Другой экземпляр приложения или двойной щелчок по .flowproj просит открыть проект. */
  onOpenProjectRequested(callback: (path: string) => void): () => void
}
