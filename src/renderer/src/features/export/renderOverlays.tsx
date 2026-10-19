// Рисунки → прозрачные PNG в размер видео (для экспорта с рисунками).
// Рисует тот же код, что и экран (ShapeView), поэтому толщина линий, наконечники и текст совпадают: SVG собирается
// из тех же компонентов, превращается в картинку и переносится на canvas в родном размере видео.
import { renderToStaticMarkup } from 'react-dom/server'
import {
  isPitchAnnotation,
  isSpotlight,
  isUnderPlayers,
  type Annotation
} from '../../../../shared/annotations'
import type { OverlayLayer } from '../../../../shared/export'
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

/**
 * Какие части рисунков попадают на картинку:
 *  «all» — всё как есть (рисунки не делятся на слои);
 *  «under» — только то, что лежит на траве у рисунков «под игроками» (слой, который ключуется по газону);
 *  «over» — всё остальное: обычные рисунки целиком, а у рисунков «под игроками» — подписи, луч, затемнение прожектора.
 */
export type OverlayPart = 'all' | 'under' | 'over'

export interface OverlaySvgOptions {
  part?: OverlayPart
  /** Во сколько раз картинка больше «логического» размера width×height (экран с devicePixelRatio). */
  scale?: number
  /** Какие рисунки показать бледнее (камера могла сдвинуться); по умолчанию — по времени кадра разметки. */
  dimmedIds?: ReadonlySet<string>
}

/** SVG с набором рисунков на кадре width×height (в пикселях видео). Порядок рисунков — порядок слоёв. */
export function buildOverlaySvg(
  items: readonly Annotation[],
  width: number,
  height: number,
  calibrations: readonly Calibration[] = [],
  options: OverlaySvgOptions = {}
): string {
  const part = options.part ?? 'all'
  const size = { w: width, h: height }
  const byId = new Map(calibrations.map((c) => [c.id, c]))
  // Затемнение прожектора — эффект на весь кадр: оно не ключуется и всегда поверх (слой «over»).
  const dim = part === 'under' ? [] : items.filter(isSpotlight)
  const shown = part === 'under' ? items.filter(isUnderPlayers) : items
  const markup = renderToStaticMarkup(
    <>
      <SpotlightDim
        items={dim}
        size={size}
        projectorOf={(id) => {
          const cal = byId.get(id)
          return cal ? projectorFor(cal) : null
        }}
      />
      {shown.map((a) => {
        const cal = isPitchAnnotation(a) ? byId.get(a.calibrationId) : undefined
        const under = isUnderPlayers(a)
        return (
          <ShapeView
            key={a.id}
            annotation={a}
            size={size}
            selected={false}
            showHandles={false}
            projector={cal ? projectorFor(cal) : null}
            dimmed={
              options.dimmedIds
                ? options.dimmedIds.has(a.id)
                : cal
                  ? !isCalibrationFresh(cal, a.timing.start)
                  : false
            }
            part={part === 'all' || !under ? 'all' : part === 'under' ? 'ground' : 'top'}
          />
        )
      })}
    </>
  )
  const scale = options.scale ?? 1
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" ` +
    `viewBox="0 0 ${width} ${height}"><style>${shadowStyle(height)}</style>${markup}</svg>`
  )
}

/** У рисунка «под игроками» есть часть, которая всегда поверх: подпись, луч прожектора (затемнение — отдельно). */
const HAS_TOP_PART = new Set(['ruler', 'pzone', 'pchain', 'pspot'])

/** Какие слои нужны набору рисунков. */
export function layersFor(items: readonly Annotation[]): { under: boolean; over: boolean } {
  return {
    under: items.some(isUnderPlayers),
    over: items.some((a) => !isUnderPlayers(a) || HAS_TOP_PART.has(a.type))
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}

/** Рисует SVG на холст (холст очищается). Общий код для PNG экспорта и для слоя «под игроками» на экране. */
export async function rasterizeSvg(
  svg: string,
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await loadImage(url)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Растеризует SVG в PNG. Холст общий для всех картинок, чтобы не выделять память на каждую заново. */
async function svgToPng(
  svg: string,
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): Promise<Uint8Array<ArrayBuffer>> {
  await rasterizeSvg(svg, canvas, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('png')
  return new Uint8Array(await blob.arrayBuffer())
}

export interface RenderedOverlay {
  key: string
  layer: OverlayLayer
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
  let done = 0
  opts.onProgress?.(0, keys.length)
  for (const key of keys) {
    if (opts.isCancelled?.()) throw new RenderCancelled()
    const indices = parseKey(key)
    if (!indices || indices.some((i) => i >= annotations.length)) throw new Error('bad key')
    const items = indices.map((i) => annotations[i])
    // Рисунки «под игроками» уходят отдельной картинкой: ffmpeg вольёт её в кадр по маске газона.
    const layers = layersFor(items)
    if (layers.over) {
      const svg = buildOverlaySvg(items, width, height, calibrations, { part: 'over' })
      result.push({ key, layer: 'over', data: await svgToPng(svg, canvas, width, height) })
    }
    if (layers.under) {
      const svg = buildOverlaySvg(items, width, height, calibrations, { part: 'under' })
      result.push({ key, layer: 'under', data: await svgToPng(svg, canvas, width, height) })
    }
    done += 1
    opts.onProgress?.(done, keys.length)
  }
  return result
}
