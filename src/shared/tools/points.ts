// Точки рисунков этапа 15: перечислить все точки рисунка и преобразовать их (сдвиг, перенос в другое пространство).
import {
  MAX_CHAIN_NODES,
  MAX_LINK_POINTS,
  MAX_ZONE_VERTICES,
  type Annotation
} from '../annotations'
import type { Pt2 } from './curve'

/** Все геометрические точки рисунка (без радиусов). Для старых видов рисунков — пусто (у них свой код). */
export function toolPointsOf(a: Annotation): Pt2[] {
  switch (a.type) {
    case 'spot':
      return [a.p1, a.p2]
    case 'curve':
    case 'pcurve':
      return [a.p1, a.p2, a.c]
    case 'pen':
    case 'zone':
    case 'chain':
    case 'link':
    case 'ppen':
    case 'pzone':
    case 'pchain':
    case 'plink':
      return [...a.points]
    case 'loupe':
      return [a.pos, a.src]
    case 'pspot':
      return [a.center]
    default:
      return []
  }
}

/** Копия рисунка, в которой каждая точка заменена на fn(точка). Для старых видов рисунков возвращает a. */
export function mapToolPoints<A extends Annotation>(a: A, fn: (p: Pt2) => Pt2): A {
  const b = a as Annotation
  switch (b.type) {
    case 'spot':
      return { ...b, p1: fn(b.p1), p2: fn(b.p2) } as A
    case 'curve':
    case 'pcurve':
      return { ...b, p1: fn(b.p1), p2: fn(b.p2), c: fn(b.c) } as A
    case 'pen':
    case 'zone':
    case 'chain':
    case 'link':
    case 'ppen':
    case 'pzone':
    case 'pchain':
    case 'plink':
      return { ...b, points: b.points.map(fn) } as A
    case 'loupe':
      return { ...b, pos: fn(b.pos), src: fn(b.src) } as A
    case 'pspot':
      return { ...b, center: fn(b.center) } as A
    default:
      return a
  }
}

/** Рисунок состоит из списка вершин, которые можно двигать, добавлять и удалять (зона, связи). */
export const hasVertices = (
  a: Annotation
): a is Extract<Annotation, { type: 'zone' | 'chain' | 'link' | 'pzone' | 'pchain' | 'plink' }> =>
  a.type === 'zone' ||
  a.type === 'chain' ||
  a.type === 'link' ||
  a.type === 'pzone' ||
  a.type === 'pchain' ||
  a.type === 'plink'

/** Наибольшее число вершин рисунка: больше добавлять нельзя. */
export const maxVertices = (a: Annotation): number =>
  a.type === 'link' || a.type === 'plink'
    ? MAX_LINK_POINTS
    : a.type === 'chain' || a.type === 'pchain'
      ? MAX_CHAIN_NODES
      : MAX_ZONE_VERTICES

/** Наименьшее число вершин: меньше удалять нельзя. */
export const minVertices = (a: Annotation): number =>
  a.type === 'zone' || a.type === 'pzone' ? 3 : 2

/** Номер вершины из id ручки «v3»; null — это не вершина. */
export function vertexIndex(handle: string): number | null {
  const m = /^v(\d+)$/.exec(handle)
  return m ? Number(m[1]) : null
}
