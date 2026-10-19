// Граф фильтров ffmpeg для экспорта с рисунками: наложение прозрачных PNG на нужные отрезки, стоп-кадры, склейка.
// Чистые функции без запуска ffmpeg — проверяются юнит-тестами и тестами с настоящим ffmpeg.
//
// Как устроен граф (все времена отсчитываются от offset: -ss перед -i сдвигает метки времени):
//   [0:v] → yuv420p → (если есть стоп-кадры: split на «основу» и «картинку с рисунками»)
//   «картинка с рисунками»: цепочка overlay, по одной на каждый набор рисунков; enable включает наложение
//     только на нужных отрезках времени;
//   куски: trim/setpts от «картинки с рисунками» до стоп-кадра и после него;
//   стоп-кадр: один кадр «основы» (trim) + overlay + tpad (клон кадра) на нужное время;
//   звук: atrim тех же кусков; на стоп-кадре — тишина той же длины (anullsrc), поэтому звук и картинка не расходятся;
//   всё вместе — concat.
//
// Рисунки «под игроками» (этап 16a): у набора рисунков может быть вторая картинка — слой «under». Он накладывается
// на копию кадра, а в кадр попадает только там, где виден газон (маска из chromakey, см. grassFilter.ts):
//   [кадр] → split=3: основа, копия под рисунки, источник маски; копия + PNG «под игроками» (overlay, enable);
//   основа + копия по маске — maskedmerge. Этот шаг идёт ДО лупы (линза увеличивает уже готовую картинку),
//   а PNG «поверх всего» — после лупы. На стоп-кадре то же самое делается над одним кадром.
import type { Timing } from '../../shared/annotations'
import type { GrassKeyValues } from '../../shared/grassKey'
import {
  parseKey,
  type AnimRun,
  type FreezePoint,
  type OverlaySegment,
  type RangePlan
} from '../../shared/exportOverlays'
import type { LoupeGeometry } from '../../shared/tools/loupe'
import { sec } from './args'
import { grassMaskLines } from './grassFilter'
import { loupeGeometryFromKeys, loupeLines, type LoupeAnimKey } from './loupe'

/** Чётные размеры кадра: yuv420p иначе не кодируется. */
const EVEN_SIZE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
/** Запас на сравнение времён с плавающей точкой. */
const TOL = 1e-4

export interface GraphAudio {
  sampleRate: number
  mono: boolean
}

/** Лупа в экспорте: номер рисунка, пиксельная геометрия и время показа. */
export interface GraphLoupe {
  index: number
  geometry: LoupeGeometry
  timing: Timing
  /** Движущаяся лупа: ключи (время видео и геометрия в пикселях). Без них линза стоит на месте. */
  anim?: LoupeAnimKey[]
}

/** Движущиеся рисунки: ряды покадровых картинок (по одному входу ffmpeg на ряд и слой). */
export interface GraphAnimation {
  runs: readonly AnimRun[]
  layers: { over: boolean; under: boolean }
}

export interface GraphInput {
  ranges: readonly RangePlan[]
  segments: readonly OverlaySegment[]
  fps: number
  /** null — у видео нет звука. */
  audio: GraphAudio | null
  /** Размер картинки видео после поворота, если он известен, и размер PNG: при расхождении PNG масштабируется. */
  videoSize?: { w: number; h: number } | null
  pngSize?: { w: number; h: number } | null
  /** Лупы: содержимое линзы делает ffmpeg, а рамку рисует PNG. */
  loupes?: readonly GraphLoupe[]
  /** Какие слои есть у набора рисунков (по ключу). Нет записи — только «поверх всего» (так было до этапа 16a). */
  layers?: ReadonlyMap<string, { over: boolean; under: boolean }>
  /** Ключ «газон»: обязателен, если у какого-то набора есть слой «под игроками». */
  grass?: GrassKeyValues
  /** Покадровые картинки движущихся рисунков. */
  animation?: GraphAnimation
}

/** Входная картинка графа: слой набора рисунков. */
export interface GraphImage {
  key: string
  layer: 'over' | 'under'
  /** Ряд покадровых картинок движущихся рисунков (кадры first…last исходного видео); ключ пуст. */
  seq?: AnimRun
  /** Картинка одного кадра движущихся рисунков для стоп-кадра (номер кадра); ключ пуст. */
  still?: number
}

export interface GraphPlan {
  /** Смещение входа (-ss): всё до начала первого отрезка пропускается. */
  offset: number
  /** Сколько секунд входа нужно прочитать от смещения (-t). */
  span: number
  script: string
  /** Ключи наборов рисунков: PNG с номером i в этом списке — вход ffmpeg номер i + 1. */
  inputKeys: string[]
  /** То же с указанием слоя (ключ может встретиться дважды: «поверх всего» и «под игроками»). */
  inputs: GraphImage[]
  /** Сколько секунд будет в готовом файле. */
  outputSeconds: number
}

const num = (v: number): string => v.toFixed(4)

/**
 * Кусок выходного видео. У обычного куска границы видео (start/end) и звука (audioStart/audioEnd) почти совпадают:
 * видео режется по серединам между кадрами, а звук — по границам кадров, чтобы звук и картинка не расходились.
 */
type Piece =
  | { kind: 'cut'; start: number; end: number; audioStart: number; audioEnd: number }
  | { kind: 'freeze'; freeze: FreezePoint }

/** Куски одного отрезка: обычные части видео и стоп-кадры между ними. Пустые куски (в них нет кадров) пропускаются. */
export function splitRange(range: RangePlan, fps: number): Piece[] {
  const frame = 1 / fps
  const pieces: Piece[] = []
  // Кадр стоп-кадра с серединой в f.time занимает [f.time − полкадра, f.time + полкадра).
  let cursor = range.start
  let audioCursor = range.start
  for (const f of range.freezes) {
    const end = f.time - frame
    // До стоп-кадра: кадр n−1 попадает в кусок, если он не раньше начала отрезка.
    if (end - cursor >= 0.5 * frame - TOL) {
      pieces.push({
        kind: 'cut',
        start: cursor,
        end,
        audioStart: audioCursor,
        audioEnd: f.time - 0.5 * frame
      })
    }
    pieces.push({ kind: 'freeze', freeze: f })
    cursor = f.time
    audioCursor = f.time + 0.5 * frame
  }
  const tailNeeded =
    range.freezes.length === 0 ? range.end - cursor > 0 : range.end - cursor > 0.5 * frame + TOL
  if (tailNeeded) {
    pieces.push({
      kind: 'cut',
      start: cursor,
      end: range.end,
      audioStart: audioCursor,
      audioEnd: range.end
    })
  }
  return pieces
}

export function planDrawn(input: GraphInput): GraphPlan {
  const { ranges, segments, fps, audio } = input
  const frame = 1 / fps
  const offset = Math.min(...ranges.map((r) => r.start))
  const span = Math.max(...ranges.map((r) => r.end)) - offset
  const rel = (t: number): string => sec(t - offset)
  const lines: string[] = []

  const allPieces = ranges.flatMap((r) => splitRange(r, fps))
  const cuts = allPieces.filter((p) => p.kind === 'cut')
  const freezes = allPieces.flatMap((p) => (p.kind === 'freeze' ? [p.freeze] : []))

  // Входы-картинки: по одному на ключ и слой. Картинка нужна основной цепочке (сегменты) и/или стоп-кадрам.
  const inputs: GraphImage[] = []
  const usage = new Map<string, { chain: boolean; freezes: number[] }>()
  const slotId = (key: string, layer: GraphImage['layer']): string => `${layer}:${key}`
  const layersOf = (key: string): GraphImage['layer'][] => {
    const l = input.layers?.get(key) ?? { over: true, under: false }
    return [...(l.over ? (['over'] as const) : []), ...(l.under ? (['under'] as const) : [])]
  }
  const slotFor = (
    key: string,
    layer: GraphImage['layer']
  ): { chain: boolean; freezes: number[] } => {
    const id = slotId(key, layer)
    let u = usage.get(id)
    if (!u) {
      u = { chain: false, freezes: [] }
      usage.set(id, u)
      inputs.push({ key, layer })
    }
    return u
  }
  const windows = new Map<string, OverlaySegment[]>()
  for (const s of segments) {
    for (const layer of layersOf(s.key)) slotFor(s.key, layer).chain = true
    windows.set(s.key, [...(windows.get(s.key) ?? []), s])
  }
  freezes.forEach((f, j) => {
    for (const layer of layersOf(f.key)) slotFor(f.key, layer).freezes.push(j)
  })
  const grass = input.grass
  if (inputs.some((x) => x.layer === 'under') && !grass) {
    throw new Error('Нет настроек ключа «газон» для рисунков под игроками')
  }

  // Подготовка картинок: split, если одна картинка нужна в нескольких местах, и масштаб, если размеры не совпали.
  const needScale =
    input.videoSize &&
    input.pngSize &&
    (input.videoSize.w !== input.pngSize.w || input.videoSize.h !== input.pngSize.h)
  const chainPad = new Map<string, string>() // слот → метка
  const freezePad = new Map<string, string>() // `${слот}#${j}` → метка
  inputs.forEach(({ key, layer }, i) => {
    const slot = slotId(key, layer)
    const u = usage.get(slot)!
    const uses = (u.chain ? 1 : 0) + u.freezes.length
    const src = `[${i + 1}:v]`
    const labels: string[] = []
    const take = (label: string): string => {
      labels.push(label)
      return label
    }
    if (u.chain) chainPad.set(slot, take(`[pc${i}]`))
    u.freezes.forEach((j) => freezePad.set(`${slot}#${j}`, take(`[pf${i}_${j}]`)))
    const pre = needScale
      ? `scale=${input.videoSize!.w}:${input.videoSize!.h},format=rgba,`
      : 'format=rgba,'
    if (uses === 1) lines.push(`${src}${pre}null${labels[0]}`)
    else lines.push(`${src}${pre}split=${uses}${labels.join('')}`)
  })

  // Движущиеся рисунки: ряды картинок идут во времени видео (сдвиг setpts), стоп-кадрам нужна картинка своего кадра.
  const animation = input.animation
  const animLayers = animation
    ? (['over', 'under'] as const).filter((layer) => animation.layers[layer])
    : []
  if (animLayers.includes('under') && !grass) {
    throw new Error('Нет настроек ключа «газон» для рисунков под игроками')
  }
  const scalePre = needScale ? `scale=${input.videoSize!.w}:${input.videoSize!.h},` : ''
  const seqPads: Array<{ layer: GraphImage['layer']; label: string }> = []
  const stillPads = new Map<string, string>() // `${слой}#${j}` → метка
  if (animation) {
    for (const run of animation.runs) {
      for (const layer of animLayers) {
        const idx = inputs.length
        inputs.push({ key: '', layer, seq: run })
        const label = `[ps${idx}]`
        // Картинка n ложится ровно на метку времени кадра n (overlay берёт ближайший по времени кадр ряда:
        // запас до соседнего кадра — полкадра в обе стороны).
        const shift = run.first / fps - offset
        lines.push(`[${idx + 1}:v]${scalePre}format=rgba,setpts=PTS+(${num(shift)})/TB${label}`)
        seqPads.push({ layer, label })
      }
    }
    freezes.forEach((f, j) => {
      if (!f.animated || f.animated.length === 0) return
      for (const layer of animLayers) {
        const idx = inputs.length
        inputs.push({ key: '', layer, still: f.frame })
        const label = `[pt${idx}]`
        lines.push(`[${idx + 1}:v]${scalePre}format=rgba${label}`)
        stillPads.set(`${layer}#${j}`, label)
      }
    })
  }
  const inputKeysAll = inputs.map((x) => x.key)

  // Основной поток.
  lines.push('[0:v]format=yuv420p[src]')
  let main = '[src]'
  let base = '[src]'
  if (freezes.length > 0) {
    lines.push('[src]split=2[ovin][basein]')
    main = '[ovin]'
    base = '[basein]'
  }
  // Сдвиг на полкадра: рисунок виден на кадре, если СЕРЕДИНА кадра в его отрезке; у ffmpeg время кадра — его начало.
  const shift = 0.5 * frame + TOL
  // Сегмент, обрезанный концом отрезка экспорта, на самом деле продолжается: последний кадр отрезка начинается раньше
  // конца, а его середина — позже. Окно продлевается на кадр (кадры за концом отрезка всё равно не попадают в файл).
  const rangeEnds = ranges.map((r) => r.end)
  const windowEnd = (s: OverlaySegment): number =>
    rangeEnds.some((e) => Math.abs(e - s.end) < 1e-6) ? s.end + frame : s.end
  /** Выражение enable: набор рисунков виден на всех своих сегментах. */
  const windowsExpr = (key: string): string =>
    (windows.get(key) ?? [])
      .map(
        (s) => `gte(t,${num(s.start - offset - shift)})*lt(t,${num(windowEnd(s) - offset - shift)})`
      )
      .join('+')
  // Рисунки «под игроками»: копия кадра с картинками «under» вливается в кадр по маске газона (до лупы).
  const underChain = inputs.filter(
    (x) => x.layer === 'under' && !x.seq && x.still === undefined && windows.has(x.key)
  )
  const underSeqs = seqPads.filter((x) => x.layer === 'under')
  if ((underChain.length > 0 || underSeqs.length > 0) && grass) {
    lines.push(`${main}split=3[gb][gd][gk]`)
    lines.push(...grassMaskLines({ id: 'g', input: '[gk]', output: '[gm]', key: grass }))
    let drawn = '[gd]'
    underChain.forEach((x, k) => {
      const out = `[gx${k}]`
      lines.push(
        `${drawn}${chainPad.get(slotId(x.key, 'under'))}overlay=x=0:y=0:eof_action=repeat:enable='${windowsExpr(x.key)}'${out}`
      )
      drawn = out
    })
    underSeqs.forEach((x, k) => {
      const out = `[gq${k}]`
      lines.push(`${drawn}${x.label}overlay=x=0:y=0:eof_action=pass${out}`)
      drawn = out
    })
    lines.push(`[gb]${drawn}[gm]maskedmerge[gr]`)
    main = '[gr]'
  }
  // Лупы «Отрезок»: линза накладывается на основной поток раньше картинок с рисунками (рамка ложится поверх неё).
  const loupes = input.loupes ?? []
  let lensCount = 0
  for (const l of loupes) {
    if (l.timing.mode !== 'range') continue
    const from = l.timing.start
    const to = from + l.timing.duration
    if (!ranges.some((r) => from < r.end && to > r.start)) continue
    const out = `[lm${lensCount}]`
    lines.push(
      ...loupeLines({
        id: `lm${lensCount}`,
        input: main,
        output: out,
        geometry: l.geometry,
        window: { from: from - offset - shift, to: to - offset - shift },
        anim: l.anim ? { keys: l.anim, shift: offset + 0.5 * frame } : undefined
      })
    )
    main = out
    lensCount += 1
  }
  let n = 0
  for (const { key, layer, seq, still } of inputs) {
    if (layer !== 'over' || seq || still !== undefined || !windows.has(key)) continue
    lines.push(
      `${main}${chainPad.get(slotId(key, 'over'))}overlay=x=0:y=0:eof_action=repeat:enable='${windowsExpr(key)}'[ov${n}]`
    )
    main = `[ov${n}]`
    n += 1
  }
  for (const x of seqPads.filter((p) => p.layer === 'over')) {
    lines.push(`${main}${x.label}overlay=x=0:y=0:eof_action=pass[ov${n}]`)
    main = `[ov${n}]`
    n += 1
  }

  // Куски и стоп-кадры.
  const mainOut = main
  const cutCount = cuts.length
  const vLabels = (prefix: string, count: number): string[] =>
    Array.from({ length: count }, (_, i) => `[${prefix}${i}]`)
  const cutSrc = vLabels('sv', cutCount)
  if (cutCount === 1) lines.push(`${mainOut}null${cutSrc[0]}`)
  else if (cutCount > 1) lines.push(`${mainOut}split=${cutCount}${cutSrc.join('')}`)
  else lines.push(`${mainOut}nullsink`)
  const freezeSrc = vLabels('bv', freezes.length)
  if (freezes.length === 1) lines.push(`${base}null${freezeSrc[0]}`)
  else if (freezes.length > 1) lines.push(`${base}split=${freezes.length}${freezeSrc.join('')}`)

  const audioFormat = audio
    ? `aformat=sample_fmts=fltp:sample_rates=${audio.sampleRate}:channel_layouts=${audio.mono ? 'mono' : 'stereo'}`
    : ''
  // Звук: одна ветка на каждый кусок и на каждый стоп-кадр (на стоп-кадре звучит звук самого кадра, дальше тишина).
  const audioBranches = cutCount + freezes.length
  const saLabels = vLabels('sa', audioBranches)
  if (audio) {
    if (audioBranches === 1) lines.push(`[0:a]${audioFormat}${saLabels[0]}`)
    else lines.push(`[0:a]${audioFormat},asplit=${audioBranches}${saLabels.join('')}`)
  }
  let audioIndex = 0

  const outLabels: string[] = []
  let cutIndex = 0
  let freezeIndex = 0
  allPieces.forEach((piece, i) => {
    if (piece.kind === 'cut') {
      const from = rel(piece.start)
      const to = rel(piece.end)
      lines.push(`${cutSrc[cutIndex]}trim=start=${from}:end=${to},setpts=PTS-STARTPTS[v${i}]`)
      if (audio) {
        lines.push(
          `${saLabels[audioIndex]}atrim=start=${rel(piece.audioStart)}:end=${rel(piece.audioEnd)},asetpts=PTS-STARTPTS[a${i}]`
        )
        audioIndex += 1
      }
      cutIndex += 1
    } else {
      const f = piece.freeze
      const j = freezeIndex
      const from = rel(f.time - frame)
      const to = rel(f.time)
      const overPad = freezePad.get(`${slotId(f.key, 'over')}#${j}`)
      const underPad = freezePad.get(`${slotId(f.key, 'under')}#${j}`)
      const stillUnder = stillPads.get(`under#${j}`)
      const stillOver = stillPads.get(`over#${j}`)
      // Кадр показывается свой обычный кадр и ещё seconds секунд (целое число кадров): видео удлиняется на seconds.
      // Число кадров задаётся явно (end_frame): по времени граница плавала на кадр.
      const frames = Math.round(f.seconds * fps) + 1
      const stopPad = sec(f.seconds + 2 * frame)
      lines.push(
        `${freezeSrc[j]}trim=start=${from}:end=${to},setpts=PTS-STARTPTS,trim=end_frame=1[fz${j}]`
      )
      let current = `[fz${j}]`
      // Рисунки «под игроками» на стоп-кадре: тот же приём над одним кадром.
      if ((underPad || stillUnder) && grass) {
        lines.push(`${current}split=3[fgb${j}][fgd${j}][fgk${j}]`)
        lines.push(
          ...grassMaskLines({ id: `fg${j}`, input: `[fgk${j}]`, output: `[fgm${j}]`, key: grass })
        )
        let drawn = `[fgd${j}]`
        if (underPad) {
          lines.push(`${drawn}${underPad}overlay=x=0:y=0:eof_action=repeat[fgx${j}]`)
          drawn = `[fgx${j}]`
        }
        if (stillUnder) {
          lines.push(`${drawn}${stillUnder}overlay=x=0:y=0:eof_action=repeat[fgy${j}]`)
          drawn = `[fgy${j}]`
        }
        lines.push(`[fgb${j}]${drawn}[fgm${j}]maskedmerge[fgr${j}]`)
        current = `[fgr${j}]`
      }
      // Лупы стоп-кадра: те рисунки набора, что являются лупами.
      const members = parseKey(f.key) ?? []
      loupes
        .filter((l) => members.includes(l.index))
        .forEach((l, k) => {
          const id = `lz${j}_${k}`
          lines.push(
            ...loupeLines({
              id,
              input: current,
              output: `[${id}o]`,
              geometry: l.anim ? loupeGeometryFromKeys(l.anim, f.time) : l.geometry,
              single: true
            })
          )
          current = `[${id}o]`
        })
      // Картинки «поверх всего»: набор рисунков стоп-кадра, затем картинка его движущихся рисунков.
      if (stillOver) {
        const overs = [overPad, stillOver].filter((x): x is string => Boolean(x))
        overs.forEach((pad, k) => {
          const out = `[fzo${j}_${k}]`
          lines.push(`${current}${pad}overlay=x=0:y=0:eof_action=repeat${out}`)
          current = out
        })
        lines.push(
          `${current}tpad=stop_mode=clone:stop_duration=${stopPad},trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`
        )
      } else {
        lines.push(
          `${current}${overPad ? `${overPad}overlay=x=0:y=0:eof_action=repeat,` : ''}tpad=stop_mode=clone:stop_duration=${stopPad},trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`
        )
      }
      if (audio) {
        const silence = sec((frames - 1) / fps)
        lines.push(
          `${saLabels[audioIndex]}atrim=start=${rel(f.time - 0.5 * frame)}:end=${rel(f.time + 0.5 * frame)},asetpts=PTS-STARTPTS[fa${j}]`
        )
        lines.push(
          `anullsrc=r=${audio.sampleRate}:cl=${audio.mono ? 'mono' : 'stereo'}:d=${silence},${audioFormat},asetpts=PTS-STARTPTS[fs${j}]`
        )
        lines.push(`[fa${j}][fs${j}]concat=n=2:v=0:a=1,asetpts=PTS-STARTPTS[a${i}]`)
        audioIndex += 1
      }
      freezeIndex += 1
    }
    outLabels.push(audio ? `[v${i}][a${i}]` : `[v${i}]`)
  })

  const total = allPieces.length
  const outputSeconds =
    ranges.reduce((sum, r) => sum + (r.end - r.start), 0) +
    freezes.reduce((sum, f) => sum + f.seconds, 0)
  lines.push(
    `${outLabels.join('')}concat=n=${total}:v=1:a=${audio ? 1 : 0}${audio ? '[cv][outa]' : '[cv]'}`
  )
  lines.push(`[cv]${EVEN_SIZE}[outv]`)
  return {
    offset,
    span,
    script: lines.join(';\n') + '\n',
    inputKeys: inputKeysAll,
    inputs,
    outputSeconds
  }
}
