// Единый контракт IPC между main, preload и renderer.
// Здесь только имена каналов и типы — никакой логики.

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

/** Результат любого IPC-вызова: либо данные, либо понятная ошибка. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Полное описание API, которое preload отдаёт в window.api. */
export interface FlowApi {
  getAppInfo(): Promise<AppInfo>
}
