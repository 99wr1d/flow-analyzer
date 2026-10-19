// Единый контракт IPC между main, preload и renderer.
// Здесь только имена каналов, типы и константы — никакой логики.
import type { CreateProjectRequest, LibraryListing } from './library'
import type {
  ProjectMeta,
  ProjectOpenResult,
  ProjectSaveRequest,
  ProjectSaveResult,
  RecentProject,
  RecoveryItem
} from './project'
import type {
  ExportProgress,
  ExportRequest,
  ExportResult,
  StageFrames,
  StageOverlays
} from './export'
import type { Settings, SettingsLoadResult } from './settings'
import type { StatsExport, StatsExportResult } from './statsExport'

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
  projectCreate: 'project:create',
  libraryList: 'library:list',
  libraryRemove: 'library:remove',
  libraryReveal: 'library:reveal',
  libraryDelete: 'library:delete',
  libraryRelocate: 'library:relocate',
  libraryUpdateMeta: 'library:update-meta',
  exportStageOverlays: 'export:stage-overlays',
  exportStageFrames: 'export:stage-frames',
  exportStart: 'export:start',
  exportCancel: 'export:cancel',
  exportReveal: 'export:reveal',
  statsExportCsv: 'stats:export-csv',
  statsReveal: 'stats:reveal',
  windowSetTitle: 'window:set-title',
  appCloseResponse: 'app:close-response',
  appConfirmClose: 'app:confirm-close',
  appCancelClose: 'app:cancel-close'
} as const

/** События, которые main отправляет интерфейсу. */
export const IPC_EVENTS = {
  closeRequested: 'app:close-requested',
  openProjectRequested: 'project:open-requested',
  exportProgress: 'export:progress'
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
  /** Создаёт файл проекта в папке проектов по умолчанию и открывает его. Видео — из videoId (выдано диалогом). */
  createProject(request: CreateProjectRequest): Promise<ProjectOpenResult>
  /** Все известные проекты со сводкой для стартового экрана. */
  listLibrary(): Promise<LibraryListing>
  /** Убирает проект из списка (файл не удаляется). */
  removeFromLibrary(path: string): Promise<void>
  /** Переносит файл проекта из списка в Корзину (не навсегда) и убирает его из списка. */
  deleteProject(path: string): Promise<void>
  /** Показывает файл проекта из списка в проводнике. */
  revealProject(path: string): Promise<void>
  /** Диалог «Найти проект»: заменяет в списке путь пропавшего проекта. Возвращает новый путь или null при отмене. */
  relocateProject(oldPath: string): Promise<string | null>
  /** Меняет название, тип, дату и заметки проекта прямо в его файле (проект не открыт). */
  updateProjectMeta(path: string, meta: ProjectMeta): Promise<void>
  /**
   * Вырезает клипы. Видео задаётся идентификатором; папку или файл пользователь выбирает в диалоге main.
   * Ход работы приходит через onExportProgress, а промис завершается, когда экспорт закончен, отменён или не удался.
   * Ошибка (reject) — запрос отклонён до начала работы.
   */
  startExport(request: ExportRequest): Promise<ExportResult>
  /**
   * Отправляет в main PNG с рисунками (в размер видео) для экспорта. main проверяет каждую картинку,
   * записывает во временную папку и выдаёт билет, который указывается в запросе startExport (drawings.token).
   */
  stageExportOverlays(overlays: StageOverlays): Promise<{ token: string }>
  /** Дополняет загрузку (по билету) покадровыми картинками движущихся рисунков. */
  stageExportFrames(frames: StageFrames): Promise<{ count: number }>
  cancelExport(): Promise<void>
  /** Показывает в проводнике файл, созданный последним экспортом (путь выбирает main, не интерфейс). */
  revealExport(): Promise<void>
  /** Сохраняет статистику в CSV (UTF-8 с BOM, «;»). Файл и папку выбирает пользователь в диалоге main. */
  exportStatsCsv(data: StatsExport): Promise<StatsExportResult>
  /** Показывает в проводнике файл, созданный последней выгрузкой статистики. */
  revealStatsFile(): Promise<void>
  onExportProgress(callback: (progress: ExportProgress) => void): () => void
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
