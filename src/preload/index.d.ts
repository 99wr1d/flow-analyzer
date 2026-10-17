import type { FlowApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    api: FlowApi
  }
}
