// Preload окна-детектора: только обмен с main, без доступа к файлам и сети.
import { contextBridge, ipcRenderer } from 'electron'
import {
  DETECTOR_CHANNELS as CH,
  type DetectorBridge,
  type DetectRequest,
  type DetectorInit
} from '../shared/tracking/detectorIpc'

const bridge: DetectorBridge = {
  hello: (): void => ipcRenderer.send(CH.hello),
  onInit: (cb: (init: DetectorInit) => void): void => {
    ipcRenderer.once(CH.init, (_event, init: DetectorInit) => cb(init))
  },
  onDetect: (cb: (req: DetectRequest) => void): void => {
    ipcRenderer.on(CH.detect, (_event, req: DetectRequest) => cb(req))
  },
  ready: (payload: unknown): void => ipcRenderer.send(CH.ready, payload),
  result: (payload: unknown): void => ipcRenderer.send(CH.result, payload)
}

contextBridge.exposeInMainWorld('detectorBridge', bridge)
