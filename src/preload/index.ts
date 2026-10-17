import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AppInfo, type FlowApi, type IpcResult } from '../shared/ipc-contract'

const api: FlowApi = {
  async getAppInfo(): Promise<AppInfo> {
    const result: IpcResult<AppInfo> = await ipcRenderer.invoke(IPC_CHANNELS.appGetInfo)
    if (!result.ok) throw new Error(result.error)
    return result.data
  }
}

contextBridge.exposeInMainWorld('api', api)
