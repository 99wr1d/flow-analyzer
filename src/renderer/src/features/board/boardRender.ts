import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BOARD_VIDEO_FPS } from '../../../../shared/board/ipc'
import { boardDuration } from '../../../../shared/board/resolve'
import { MAX_THUMB, type Board } from '../../../../shared/board/schema'
import { rasterizeSvg } from '../export/renderOverlays'
import { BoardScene } from './BoardScene'

export const EXPORT_W = 1920
export const EXPORT_H = 1080

const THUMB_W = 320
const THUMB_H = 180

export type BoardAt = { frame: number } | { time: number }

/** SVG сцены для растеризации: с размером и xmlns, чтобы загружаться как отдельная картинка. */
export function buildBoardSvg(board: Board, at: BoardAt, w = EXPORT_W, h = EXPORT_H): string {
  const scene = renderToStaticMarkup(createElement(BoardScene, { board, ...at }))
  return scene.replace(
    '<svg ',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `
  )
}

// Холст нужен только в приложении; в vitest его нет, поэтому эти функции не покрыты тестами.
function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

async function canvasToBytes(canvas: HTMLCanvasElement, type: string): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type))
  if (!blob) throw new Error('png')
  return new Uint8Array(await blob.arrayBuffer())
}

export async function renderBoardPng(
  board: Board,
  frame: number,
  canvas: HTMLCanvasElement = makeCanvas(EXPORT_W, EXPORT_H)
): Promise<Uint8Array> {
  await rasterizeSvg(buildBoardSvg(board, { frame }), canvas, EXPORT_W, EXPORT_H)
  return canvasToBytes(canvas, 'image/png')
}

export interface VideoFramesOptions {
  signal?: AbortSignal
  /** Подмена растеризации (тесты); по умолчанию — холст. */
  rasterize?: (svg: string) => Promise<Uint8Array>
}

/** Кадры видео на i / BOARD_VIDEO_FPS. Подряд идущие одинаковые кадры растеризуются один раз. */
export async function* renderBoardVideoFrames(
  board: Board,
  opts: VideoFramesOptions = {}
): AsyncGenerator<{ index: number; png: Uint8Array }> {
  const { signal } = opts
  let canvas: HTMLCanvasElement | undefined
  const rasterize =
    opts.rasterize ??
    (async (svg: string): Promise<Uint8Array> => {
      canvas ??= makeCanvas(EXPORT_W, EXPORT_H)
      await rasterizeSvg(svg, canvas, EXPORT_W, EXPORT_H)
      return canvasToBytes(canvas, 'image/png')
    })
  const total = Math.ceil(boardDuration(board) * BOARD_VIDEO_FPS)
  let lastSvg = ''
  let lastPng: Uint8Array | undefined
  for (let i = 0; i < total; i++) {
    signal?.throwIfAborted()
    const svg = buildBoardSvg(board, { time: i / BOARD_VIDEO_FPS })
    // data-time отличается в каждом кадре, поэтому сравниваем сцену без него
    const key = svg.replace(/ data-time="[^"]*"/, '')
    if (!lastPng || key !== lastSvg) {
      lastPng = await rasterize(svg)
      lastSvg = key
    }
    yield { index: i, png: lastPng }
  }
}

/** Миниатюра доски: JPEG 320×180 data:-URL, качество снижается до укладывания в лимит. */
export async function renderBoardThumb(board: Board): Promise<string> {
  const canvas = makeCanvas(THUMB_W, THUMB_H)
  await rasterizeSvg(buildBoardSvg(board, { frame: 0 }, THUMB_W, THUMB_H), canvas, THUMB_W, THUMB_H)
  let url = ''
  for (let q = 0.8; q >= 0.2; q -= 0.15) {
    url = canvas.toDataURL('image/jpeg', q)
    if (url.length <= MAX_THUMB) break
  }
  return url
}
