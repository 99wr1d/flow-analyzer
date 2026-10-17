import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC_CHANNELS,
  type AppInfo,
  type FlowApi,
  type IpcResult,
  type VideoProbe,
  type VideoSource
} from '../shared/ipc-contract'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: IpcResult<T> = await ipcRenderer.invoke(channel, ...args)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

const api: FlowApi = {
  getAppInfo: () => invoke<AppInfo>(IPC_CHANNELS.appGetInfo),
  openVideoDialog: () => invoke<VideoSource | null>(IPC_CHANNELS.videoOpenDialog),
  probeVideo: (id: string) => invoke<VideoProbe>(IPC_CHANNELS.videoProbe, id),
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
