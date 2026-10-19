// Рисунки → прозрачные PNG в размер видео (для экспорта с рисунками).
// Рисует тот же код, что и экран (ShapeView), поэтому толщина линий, наконечники и текст совпадают: SVG собирается
// из тех же компонентов, превращается в картинку и переносится на canvas в родном размере видео.
import { renderToStaticMarkup } from 'react-dom/server'
import { isPitchAnnotation, isSpotlight, type Annotation } from '../../../../shared/annotations'
import { parseKey } from '../../../../shared/exportOverlays'
import {
  isCalibrationFresh,
  projectorFor,
  type Calibration
} from '../../../../shared/pitch/calibration'
import { ShapeView } from '../annotations/ShapeView'
import { SpotlightDim } from '../annotations/SpotlightDim'

/** Высота картинки на экране, при которой тени рисунков имеют размер, заданный в CSS (2.5 px); на большем кадре тень растёт. */
const SCREEN_REFERENCE_HEIGHT = 560

/** Тени из styles/annotations.css (.anno-shape), пересчитанные под размер кадра. */
function shadowStyle(height: number): string {
  const k = height / SCREEN_REFERENCE_HEIGHT
  const f = (v: number): string => `${Math.round(v * k * 100) / 100}px`
  return (
    `.anno-shape{filter:drop-shadow(0 ${f(1)} ${f(2.5)} rgba(0,0,0,0.7))}` +
    `.anno-shape--dark{filter:drop-shadow(0 0 ${f(2)} rgba(255,255,255,0.85))}`
  )
}

/** SVG с набором рисунков на кадре width×height (в пикселях видео). Порядок рисунков — порядок слоёв. */
export function buildOverlaySvg(
  items: readonly Annotation[],
  width: number,
  height: number,
  calibrations: readonly Calibration[] = []
): string {
  const size = { w: width, h: height }
  const byId = new Map(calibrations.map((c) => [c.id, c]))
  const markup = renderToStaticMarkup(
    <>
      <SpotlightDim
        items={items.filter(isSpotlight)}
        size={size}
        projectorOf={(id) => {
          const cal = byId.get(id)
          return cal ? projectorFor(cal) : null
        }}
      />
      {items.map((a) => {
        const cal = isPitchAnnotation(a) ? byId.get(a.calibrationId) : undefined
        return (
          <ShapeView
            key={a.id}
            annotation={a}
            size={size}
            selected={false}
            showHandles={false}
            projector={cal ? projectorFor(cal) : null}
            dimmed={cal ? !isCalibrationFresh(cal, a.timing.start) : false}
          />
        )
      })}
    </>
  )
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><style>${shadowStyle(height)}</style>${markup}</svg>`
  )
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}

/** Растеризует SVG в PNG. Холст общий для всех картинок, чтобы не выделять память на каждую заново. */
async function svgToPng(
  svg: string,
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): Promise<Uint8Array<ArrayBuffer>> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await loadImage(url)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('png')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface RenderedOverlay {
  key: string
  data: Uint8Array<ArrayBuffer>
}

export class RenderCancelled extends Error {}

/**
 * Рисует по одной картинке на каждый ключ (набор рисунков). annotations — снимок рисунков в порядке слоёв.
 * isCancelled проверяется между картинками.
 */
export async function renderOverlayImages(opts: {
  annotations: readonly Annotation[]
  /** Разметки поля — нужны рисункам на поле. */
  calibrations?: readonly Calibration[]
  keys: readonly string[]
  width: number
  height: number
  isCancelled?: () => boolean
  onProgress?: (done: number, total: number) => void
}): Promise<RenderedOverlay[]> {
  const { annotations, keys, width, height } = opts
  const calibrations = opts.calibrations ?? []
  // Текст рисуется системным шрифтом; ждём готовности шрифтов, чтобы размеры подписей были как на экране.
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const result: RenderedOverlay[] = []
  opts.onProgress?.(0, keys.length)
  for (const key of keys) {
    if (opts.isCancelled?.()) throw new RenderCancelled()
    const indices = parseKey(key)
    if (!indices || indices.some((i) => i >= annotations.length)) throw new Error('bad key')
    const svg = buildOverlaySvg(
      indices.map((i) => annotations[i]),
      width,
      height,
      calibrations
    )
    result.push({ key, data: await svgToPng(svg, canvas, width, height) })
    opts.onProgress?.(result.length, keys.length)
  }
  return result
}
