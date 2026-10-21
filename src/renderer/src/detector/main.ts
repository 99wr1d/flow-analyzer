// Скрытое окно-детектор: onnxruntime-web (WebGPU, запасной путь — WASM) + D-FINE-S. Без Node и без сети:
// модель приходит байтами от main, кадры — тоже. Ответ: рамки людей, их примета (look) и гистограмма кадра.
import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import { lookOf } from '../../../shared/tracking/appearance'
import { frameHistOf } from '../../../shared/tracking/sceneCut'
import type {
  DetectRequest,
  DetectorBackend,
  DetectorBridge,
  DetectorInit
} from '../../../shared/tracking/detectorIpc'
import { decodePersons, prepareInput, roiCrop } from './postprocess'

declare global {
  interface Window {
    detectorBridge: DetectorBridge
  }
}

const bridge = window.detectorBridge
const MAX_THREADS = 8

async function createSession(
  model: Uint8Array,
  wanted: DetectorBackend | null
): Promise<{ session: ort.InferenceSession; backend: DetectorBackend }> {
  ort.env.logLevel = 'error'
  ort.env.wasm.wasmPaths = {
    mjs: new URL(mjsUrl, location.href).href,
    wasm: new URL(wasmUrl, location.href).href
  }
  ort.env.wasm.numThreads = Math.max(1, Math.min(MAX_THREADS, navigator.hardwareConcurrency || 4))
  const options = { graphOptimizationLevel: 'all' as const }
  if (wanted !== 'wasm') {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
      const adapter = await gpu?.requestAdapter()
      if (adapter) {
        const session = await ort.InferenceSession.create(model, {
          ...options,
          executionProviders: ['webgpu']
        })
        return { session, backend: 'webgpu' }
      }
      console.warn('WebGPU: видеокарта недоступна (нет адаптера), работаем на процессоре')
    } catch (error) {
      console.warn(`WebGPU: сессия не создалась, работаем на процессоре: ${String(error)}`)
    }
  }
  const session = await ort.InferenceSession.create(model, {
    ...options,
    executionProviders: ['wasm']
  })
  return { session, backend: 'wasm' }
}

async function start(init: DetectorInit): Promise<void> {
  let session: ort.InferenceSession
  try {
    const created = await createSession(init.model, init.backend)
    session = created.session
    bridge.ready({ ok: true, backend: created.backend })
  } catch (error) {
    bridge.ready({ ok: false, error: String(error instanceof Error ? error.message : error) })
    return
  }
  const inputName = session.inputNames[0]
  // Запросы идут по одному: сессия не любит параллельных run().
  let chain: Promise<void> = Promise.resolve()
  bridge.onDetect((req) => {
    chain = chain.then(() => handle(req))
  })

  async function handle(req: DetectRequest): Promise<void> {
    try {
      const rgba = new Uint8Array(req.rgba.buffer, req.rgba.byteOffset, req.rgba.byteLength)
      const crop = req.roi
        ? roiCrop(req.roi, req.width, req.height)
        : { x: 0, y: 0, w: req.width, h: req.height }
      const input = prepareInput(rgba, req.width, crop)
      const out = await session.run({
        [inputName]: new ort.Tensor('float32', input.data, [1, 3, input.inputH, input.inputW])
      })
      const logits = out['logits']
      const boxes = out['pred_boxes']
      const numQueries = logits.dims[1]
      const numClasses = logits.dims[2]
      const persons = decodePersons(logits.data as Float32Array, boxes.data as Float32Array, {
        numQueries,
        numClasses,
        inputW: input.inputW,
        inputH: input.inputH,
        crop
      })
      const detections = persons.map((p) => ({
        box: p.box,
        score: p.score,
        look: lookOf(rgba, req.width, req.height, p.box)
      }))
      bridge.result({
        id: req.id,
        ok: true,
        detections,
        frameHist: frameHistOf(rgba, req.width, req.height)
      })
    } catch (error) {
      bridge.result({
        id: req.id,
        ok: false,
        error: String(error instanceof Error ? error.message : error)
      })
    }
  }
}

bridge.onInit((init) => void start(init))
bridge.hello()
