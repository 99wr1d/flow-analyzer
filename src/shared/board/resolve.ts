/** Состояние элементов доски в кадре и сцена во времени (чистые функции). */
import { smoothstep } from '../animation'
import { GEOM_KEYS, shapeGeomKeys } from './schema'
import type { Board, BoardElement, BoardItem } from './schema'

/** Секунды видео до первого перехода и после последнего. */
export const LEAD_IN = 0.5
export const HOLD_END = 1.0

export const boardDuration = (b: Board): number =>
  LEAD_IN + (b.frameCount - 1) * b.transition + HOLD_END

export const frameStart = (b: Board, frame: number): number => LEAD_IN + frame * b.transition

export interface ResolvedItem {
  id: string
  el: BoardElement
  opacity: number
}

type Rec = Record<string, unknown>

/** Ключи геометрии, допустимые для данного элемента, и объект, в котором они лежат. */
function geomKeys(el: BoardElement): readonly string[] {
  return el.kind === 'shape' ? shapeGeomKeys(el.ann.type) : GEOM_KEYS[el.kind]
}

export function elementAt(item: BoardItem, frame: number): BoardElement {
  let el: BoardElement = item.el
  for (const s of item.states) {
    if (s.frame > frame) break
    const next = { ...el } as Rec
    if (s.geom) {
      const allowed = geomKeys(el)
      const target: Rec = el.kind === 'shape' ? { ...el.ann } : next
      for (const k of allowed) if (k in s.geom) target[k] = s.geom[k]
      if (el.kind === 'shape') next.ann = target
    }
    if (el.kind === 'figure') {
      if (s.pose !== undefined) next.pose = s.pose
      if (s.facing !== undefined) next.facing = s.facing
    }
    el = next as BoardElement
  }
  return el
}

export const visibleAt = (item: BoardItem, frame: number): boolean =>
  item.show.from <= frame && frame <= item.show.to

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u

function lerpAngle(a: number, b: number, u: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  let r = a + d * u
  if (r > 180) r -= 360
  if (r < -180) r += 360
  return r
}

function lerpValue(key: string, a: unknown, b: unknown, u: number): unknown {
  if (typeof a === 'number' && typeof b === 'number')
    return key === 'rotation' ? lerpAngle(a, b, u) : lerp(a, b, u)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return u < 0.5 ? a : b
    return a.map((x, i) => lerpValue(key, x, b[i], u))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Rec
    const rb = b as Rec
    const out: Rec = {}
    for (const k of Object.keys(ra)) out[k] = k in rb ? lerpValue(k, ra[k], rb[k], u) : ra[k]
    return out
  }
  return u < 0.5 ? a : b
}

function lerpGeom(target: Rec, a: Rec, b: Rec, keys: readonly string[], u: number): void {
  for (const k of keys) if (k in a && k in b) target[k] = lerpValue(k, a[k], b[k], u)
}

function blend(a: BoardElement, b: BoardElement, u: number): BoardElement {
  if (a.kind !== b.kind) return u < 0.5 ? a : b
  const out = { ...a } as Rec
  const keys = geomKeys(a)
  if (a.kind === 'shape' && b.kind === 'shape') {
    if (a.ann.type !== b.ann.type) return u < 0.5 ? a : b
    const ann = { ...a.ann } as Rec
    lerpGeom(ann, a.ann as Rec, b.ann as Rec, keys, u)
    out.ann = ann
  } else {
    lerpGeom(out, a as Rec, b as Rec, keys, u)
  }
  if (a.kind === 'figure' && b.kind === 'figure' && u >= 0.5) {
    out.pose = b.pose
    out.facing = b.facing
  }
  return out as BoardElement
}

function resolve(b: Board, f: number, u: number): ResolvedItem[] {
  const out: ResolvedItem[] = []
  const g = f + 1
  for (const item of b.items) {
    const va = visibleAt(item, f) ? 1 : 0
    const el = u > 0 ? blend(elementAt(item, f), elementAt(item, g), u) : elementAt(item, f)
    const opacity = u > 0 ? lerp(va, visibleAt(item, g) ? 1 : 0, u) : va
    if (opacity !== 0) out.push({ id: item.id, el, opacity })
  }
  return out
}

export function sceneAtFrame(b: Board, frame: number): ResolvedItem[] {
  return resolve(b, Math.max(0, Math.min(b.frameCount - 1, frame)), 0)
}

export function sceneAt(b: Board, t: number): ResolvedItem[] {
  const last = b.frameCount - 1
  const s = Math.max(0, Math.min(last, (t - LEAD_IN) / b.transition))
  if (!Number.isFinite(s) || last === 0) return resolve(b, 0, 0)
  const f = Math.min(Math.floor(s), last - 1)
  const frac = s - f
  return resolve(b, f, smoothstep(frac))
}
