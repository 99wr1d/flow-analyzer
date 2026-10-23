import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type AppInfo,
  type FlowApi,
  type IpcResult,
  type VideoProbe,
  type VideoSource
} from '../shared/ipc-contract'
import type {
  ExportEncoderInfo,
  ExportProgress,
  ExportRequest,
  ExportResult,
  StageFrames,
  StageOverlays
} from '../shared/export'
import type { AboutInfo, LicenseTexts, LogEntry } from '../shared/log'
import type { CreateProjectRequest, LibraryListing } from '../shared/library'
import type {
  ProjectMeta,
  ProjectOpenResult,
  ProjectSaveRequest,
  ProjectSaveResult,
  RecentProject,
  RecoveryItem
} from '../shared/project'
import type { Settings, SettingsLoadResult } from '../shared/settings'
import type { StatsExport, StatsExportResult } from '../shared/statsExport'
import type {
  TrackingAsk,
  TrackingDone,
  TrackingProgress,
  TrackingStartRequest
} from '../shared/tracking/trackingIpc'

/** Подписка на событие main; приходят только объекты (остальное отбрасывается). */
function onEvent<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (payload && typeof payload === 'object') callback(payload as T)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: IpcResult<T> = await ipcRenderer.invoke(channel, ...args)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

const api: FlowApi = {
  getAppInfo: () => invoke<AppInfo>(IPC_CHANNELS.appGetInfo),
  getAboutInfo: () => invoke<AboutInfo>(IPC_CHANNELS.appAbout),
  getLicenses: () => invoke<LicenseTexts>(IPC_CHANNELS.appLicenses),
  openLogsFolder: () => invoke<void>(IPC_CHANNELS.appOpenLogs),
  writeLog: (entry: LogEntry) => invoke<void>(IPC_CHANNELS.logWrite, entry),
  openVideoDialog: () => invoke<VideoSource | null>(IPC_CHANNELS.videoOpenDialog),
  probeVideo: (id: string) => invoke<VideoProbe>(IPC_CHANNELS.videoProbe, id),
  getSettings: () => invoke<SettingsLoadResult>(IPC_CHANNELS.settingsGet),
  saveSettings: (settings: Settings) => invoke<Settings>(IPC_CHANNELS.settingsSet, settings),
  saveProject: (request: ProjectSaveRequest, saveAs: boolean) =>
    invoke<ProjectSaveResult>(IPC_CHANNELS.projectSave, request, saveAs),
  openProject: (path: string | null) => invoke<ProjectOpenResult>(IPC_CHANNELS.projectOpen, path),
  relinkProjectVideo: (ticket: string) =>
    invoke<ProjectOpenResult>(IPC_CHANNELS.projectRelinkVideo, ticket),
  listRecentProjects: () => invoke<RecentProject[]>(IPC_CHANNELS.projectRecent),
  autosaveProject: (request: ProjectSaveRequest) =>
    invoke<void>(IPC_CHANNELS.projectAutosave, request),
  listRecovery: () => invoke<RecoveryItem[]>(IPC_CHANNELS.projectRecoveryList),
  restoreRecovery: (key: string) =>
    invoke<ProjectOpenResult>(IPC_CHANNELS.projectRecoveryRestore, key),
  discardRecovery: (key: string) => invoke<void>(IPC_CHANNELS.projectRecoveryDiscard, key),
  clearRecovery: (path: string | null) => invoke<void>(IPC_CHANNELS.projectClearRecovery, path),
  takeLaunchProject: () => invoke<string | null>(IPC_CHANNELS.projectTakeLaunchPath),
  createProject: (request: CreateProjectRequest) =>
    invoke<ProjectOpenResult>(IPC_CHANNELS.projectCreate, request),
  listLibrary: () => invoke<LibraryListing>(IPC_CHANNELS.libraryList),
  removeFromLibrary: (path: string) => invoke<void>(IPC_CHANNELS.libraryRemove, path),
  deleteProject: (path: string) => invoke<void>(IPC_CHANNELS.libraryDelete, path),
  revealProject: (path: string) => invoke<void>(IPC_CHANNELS.libraryReveal, path),
  relocateProject: (oldPath: string) =>
    invoke<string | null>(IPC_CHANNELS.libraryRelocate, oldPath),
  updateProjectMeta: (path: string, meta: ProjectMeta) =>
    invoke<void>(IPC_CHANNELS.libraryUpdateMeta, path, meta),
  startExport: (request: ExportRequest) => invoke<ExportResult>(IPC_CHANNELS.exportStart, request),
  stageExportOverlays: (overlays: StageOverlays) =>
    invoke<{ token: string }>(IPC_CHANNELS.exportStageOverlays, overlays),
  stageExportFrames: (frames: StageFrames) =>
    invoke<{ count: number }>(IPC_CHANNELS.exportStageFrames, frames),
  getExportEncoderInfo: () => invoke<ExportEncoderInfo>(IPC_CHANNELS.exportEncoders),
  cancelExport: () => invoke<void>(IPC_CHANNELS.exportCancel),
  revealExport: () => invoke<void>(IPC_CHANNELS.exportReveal),
  exportStatsCsv: (data: StatsExport) =>
    invoke<StatsExportResult>(IPC_CHANNELS.statsExportCsv, data),
  revealStatsFile: () => invoke<void>(IPC_CHANNELS.statsReveal),
  onExportProgress(callback: (progress: ExportProgress) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown): void => {
      if (progress && typeof progress === 'object') callback(progress as ExportProgress)
    }
    ipcRenderer.on(IPC_EVENTS.exportProgress, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.exportProgress, listener)
  },
  startTracking: (request: TrackingStartRequest) =>
    invoke<{ jobId: string }>(IPC_CHANNELS.trackingStart, request),
  resolveTracking: (jobId: string, index: number | 'none', target = 0) =>
    invoke<void>(IPC_CHANNELS.trackingResolve, { jobId, index, target }),
  cancelTracking: (jobId: string) => invoke<void>(IPC_CHANNELS.trackingCancel, { jobId }),
  onTrackingProgress: (callback: (progress: TrackingProgress) => void) =>
    onEvent(IPC_EVENTS.trackingProgress, callback),
  onTrackingAsk: (callback: (ask: TrackingAsk) => void) =>
    onEvent(IPC_EVENTS.trackingAsk, callback),
  onTrackingDone: (callback: (done: TrackingDone) => void) =>
    onEvent(IPC_EVENTS.trackingDone, callback),
  setWindowTitle: (name: string | null, dirty: boolean) =>
    invoke<void>(IPC_CHANNELS.windowSetTitle, name, dirty),
  onCloseRequested(callback: () => void): () => void {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_EVENTS.closeRequested, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.closeRequested, listener)
  },
  respondClose: (dirty: boolean) => invoke<void>(IPC_CHANNELS.appCloseResponse, dirty),
  confirmClose: () => invoke<void>(IPC_CHANNELS.appConfirmClose),
  cancelClose: () => invoke<void>(IPC_CHANNELS.appCancelClose),
  onOpenProjectRequested(callback: (path: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, path: unknown): void => {
      if (typeof path === 'string') callback(path)
    }
    ipcRenderer.on(IPC_EVENTS.openProjectRequested, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.openProjectRequested, listener)
  },
  importDroppedVideo(file: File): Promise<VideoSource> {
    let path: string
    try {
      path = webUtils.getPathForFile(file)
    } catch {
      return Promise.reject(new Error('Не удалось определить путь к файлу'))
    }
    return invoke<VideoSource>(IPC_CHANNELS.videoImportPath, path)
  }
}

contextBridge.exposeInMainWorld('api', api)
