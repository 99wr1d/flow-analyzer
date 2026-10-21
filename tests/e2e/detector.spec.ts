// Окно-детектор слежения: настоящая модель D-FINE-S запускается в скрытом окне на обоих бэкендах (webgpu и wasm)
// и отвечает по форме на синтетическом кадре (людей может не найти — проверяется контракт, а не качество).
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launch } from './helpers'

interface Probe {
  backend: string
  windowsBefore: number
  windowsDuring: number
  windowsAfter: number
  full: { count: number; bad: string[]; histSum: number }
  roi: { count: number; bad: string[]; histSum: number }
  msFull: number
  msRoi: number
  afterCloseRejected: boolean
  badFrameRejected: boolean
  detectorIsolated: boolean
}

/** Всё выполняется в главном процессе: кадр 960×540 с тремя «фигурками», полный кадр и вырез вокруг одной из них. */
async function probe(app: ElectronApplication): Promise<Probe> {
  return app.evaluate(async ({ BrowserWindow }): Promise<Probe> => {
    type Det = {
      box: { x: number; y: number; w: number; h: number }
      score: number
      look: Float32Array
    }
    type Out = { detections: Det[]; frameHist: Float32Array }
    type Detector = {
      backend: string
      detect(f: unknown, roi?: unknown): Promise<Out>
      close(): void
    }
    const create = (globalThis as Record<string, unknown>)[
      '__flowCreateDetector'
    ] as () => Promise<Detector>
    const width = 960
    const height = 540
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i += 1) {
      rgba.set([52, 140, 68, 255], i * 4)
    }
    const fill = (x0: number, y0: number, x1: number, y1: number, c: number[]): void => {
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) rgba.set(c, (y * width + x) * 4)
    }
    for (const [cx, shirt] of [
      [200, [200, 30, 30]],
      [480, [30, 60, 200]],
      [760, [240, 240, 240]]
    ] as const) {
      fill(cx - 12, 200, cx + 12, 224, [225, 180, 150])
      fill(cx - 22, 224, cx + 22, 290, [...shirt, 255])
      fill(cx - 20, 290, cx + 20, 330, [20, 20, 20, 255])
      fill(cx - 18, 330, cx - 4, 380, [225, 180, 150, 255])
      fill(cx + 4, 330, cx + 18, 380, [225, 180, 150, 255])
    }
    const frame = { rgba, width, height }
    const check = (out: Out, where: { x: number; y: number; w: number; h: number }): string[] => {
      const bad: string[] = []
      for (const d of out.detections) {
        const { x, y, w, h } = d.box
        if (![x, y, w, h, d.score].every(Number.isFinite)) bad.push('не число')
        if (w < 2 || h < 2) bad.push('мала')
        if (
          x < where.x - 0.5 ||
          y < where.y - 0.5 ||
          x + w > where.x + where.w + 0.5 ||
          y + h > where.y + where.h + 0.5
        ) {
          bad.push(`вне выреза ${JSON.stringify(d.box)}`)
        }
        if (d.score < 0.4 || d.score > 1) bad.push('порог')
        if (d.look.length !== 96) bad.push('look')
      }
      if (out.frameHist.length !== 48) bad.push('frameHist')
      return bad
    }
    const histSum = (o: Out): number => o.frameHist.reduce((a, b) => a + b, 0)
    const windowsBefore = BrowserWindow.getAllWindows().length
    const det = await create()
    const windowsDuring = BrowserWindow.getAllWindows().length
    const roi = { x: 458, y: 200, w: 44, h: 180 }
    // Прогрев (компиляция шейдеров), затем замер.
    await det.detect(frame)
    await det.detect(frame, roi)
    const N = 5
    let t0 = performance.now()
    let full!: Out
    for (let i = 0; i < N; i += 1) full = await det.detect(frame)
    const msFull = (performance.now() - t0) / N
    t0 = performance.now()
    let part!: Out
    for (let i = 0; i < N; i += 1) part = await det.detect(frame, roi)
    const msRoi = (performance.now() - t0) / N
    const badFrameRejected = await det.detect({ rgba: new Uint8Array(10), width, height }).then(
      () => false,
      (e: Error) => /Кадр для детектора/.test(e.message)
    )
    const detWin = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().startsWith('flow-detector://')
    )
    const detectorIsolated = detWin
      ? ((await detWin.webContents.executeJavaScript('crossOriginIsolated')) as boolean)
      : false
    det.close()
    const afterCloseRejected = await det.detect(frame).then(
      () => false,
      () => true
    )
    await new Promise((r) => setTimeout(r, 300))
    return {
      backend: det.backend,
      windowsBefore,
      windowsDuring,
      windowsAfter: BrowserWindow.getAllWindows().length,
      full: {
        count: full.detections.length,
        bad: check(full, { x: 0, y: 0, w: width, h: height }),
        histSum: histSum(full)
      },
      roi: {
        count: part.detections.length,
        bad: check(
          part,
          {
            x: 160,
            y: 98,
            w: 640,
            h: 384
          } /* roiCrop: центр на игроке (y 200..380), вырез сдвинут вверх на 98 */
        ),
        histSum: histSum(part)
      },
      msFull,
      msRoi,
      afterCloseRejected,
      badFrameRejected,
      detectorIsolated
    }
  })
}

for (const wanted of ['webgpu', 'wasm'] as const) {
  test(`окно-детектор: настоящая модель отвечает на бэкенде ${wanted}`, async () => {
    const testInfo = test.info()
    test.setTimeout(240_000)
    const { app, win } = await launch({
      env: {
        FLOW_TEST_DETECTOR: '1',
        ...(wanted === 'wasm' ? { FLOW_DETECTOR_BACKEND: 'wasm' } : {})
      }
    })
    try {
      const r = await probe(app)
      // SharedArrayBuffer есть только у окна-детектора (изоляция по схеме flow-detector), у основного окна его нет.
      const mainIsolation = await win.evaluate(() => ({
        isolated: crossOriginIsolated,
        sab: typeof SharedArrayBuffer
      }))
      expect(mainIsolation).toEqual({ isolated: false, sab: 'undefined' })
      expect(r.detectorIsolated).toBe(true)
      console.log(`[detector ${wanted}] ${JSON.stringify(r)}`)
      testInfo.annotations.push({
        type: 'detector',
        description: `backend=${r.backend} full=${r.msFull.toFixed(1)}ms roi=${r.msRoi.toFixed(1)}ms found=${r.full.count}/${r.roi.count}`
      })
      if (wanted === 'webgpu' && r.backend !== 'webgpu') {
        // Видеокарты/WebGPU на этой машине нет: допустим только чистый откат на процессор, и о нём говорим вслух.
        console.warn('[detector webgpu] WebGPU недоступен, детектор откатился на wasm')
        expect(r.backend).toBe('wasm')
      } else {
        expect(r.backend).toBe(wanted)
      }
      expect(r.windowsDuring).toBe(r.windowsBefore + 1)
      expect(r.full.bad).toEqual([])
      expect(r.roi.bad).toEqual([])
      expect(r.full.histSum).toBeCloseTo(3, 3)
      expect(r.roi.histSum).toBeCloseTo(3, 3)
      expect(r.windowsAfter).toBe(r.windowsBefore)
      expect(r.afterCloseRejected).toBe(true)
      expect(r.badFrameRejected).toBe(true)
    } finally {
      await app.close()
    }
  })
}

test('окно-детектор можно создавать повторно в одном запуске: окна не копятся', async () => {
  test.setTimeout(240_000)
  const { app } = await launch({ env: { FLOW_TEST_DETECTOR: '1', FLOW_DETECTOR_BACKEND: 'wasm' } })
  try {
    const r = await app.evaluate(async ({ BrowserWindow }) => {
      type Detector = {
        detect(f: unknown): Promise<{ frameHist: Float32Array }>
        close(): void
      }
      const create = (globalThis as Record<string, unknown>)[
        '__flowCreateDetector'
      ] as () => Promise<Detector>
      const frame = { rgba: new Uint8Array(320 * 240 * 4), width: 320, height: 240 }
      const before = BrowserWindow.getAllWindows().length
      const hist: number[] = []
      for (let i = 0; i < 2; i += 1) {
        const det = await create()
        hist.push((await det.detect(frame)).frameHist.length)
        det.close()
        await new Promise((res) => setTimeout(res, 300))
      }
      return { before, after: BrowserWindow.getAllWindows().length, hist }
    })
    expect(r.hist).toEqual([48, 48])
    expect(r.after).toBe(r.before)
  } finally {
    await app.close()
  }
})
