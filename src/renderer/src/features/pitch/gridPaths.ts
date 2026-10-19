// Линии поля, спроецированные на картинку, в виде данных SVG-пути (для сетки поверх видео и предпросмотра разметки).
import {
  arcPoints,
  pitchLines,
  type PitchPrimitive,
  type PitchSize
} from '../../../../shared/pitch/landmarks'
import type { Pt } from '../../../../shared/pitch/linalg'
import type { Projector } from '../../../../shared/pitch/projector'
import type { RectSize, TemplateId } from '../../../../shared/pitch/templates'

/** Линии для рисования: у шаблона «прямоугольник» — рамка и средние линии, иначе — всё поле. */
export function gridPrimitives(
  template: TemplateId,
  pitch: PitchSize,
  rect: RectSize
): PitchPrimitive[] {
  if (template !== 'rect') return pitchLines(pitch)
  return [
    {
      kind: 'polyline',
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: rect.w, y: 0 },
        { x: rect.w, y: rect.h },
        { x: 0, y: rect.h }
      ]
    },
    {
      kind: 'polyline',
      closed: false,
      points: [
        { x: rect.w / 2, y: 0 },
        { x: rect.w / 2, y: rect.h }
      ]
    },
    {
      kind: 'polyline',
      closed: false,
      points: [
        { x: 0, y: rect.h / 2 },
        { x: rect.w, y: rect.h / 2 }
      ]
    }
  ]
}

function worldPolyline(p: PitchPrimitive): Pt[] {
  if (p.kind === 'polyline') return p.closed ? [...p.points, p.points[0]] : p.points
  const span = Math.abs(p.to - p.from)
  // Около одного отрезка на 2°: гладко даже у большого центрального круга на крупном кадре.
  const n = Math.max(8, Math.ceil((span * 180) / Math.PI / 2))
  return arcPoints(p.center, p.radius, p.from, p.to, n)
}

/** Путь SVG (в пикселях картинки) для набора линий. Куски за камерой отсекаются. */
export function gridPath(
  proj: Projector,
  primitives: readonly PitchPrimitive[],
  size: { w: number; h: number }
): string {
  const parts: string[] = []
  for (const prim of primitives) {
    for (const piece of proj.projectPolyline(worldPolyline(prim))) {
      if (piece.length < 2) continue
      parts.push(
        'M' +
          piece.map((p) => `${(p.x * size.w).toFixed(1)},${(p.y * size.h).toFixed(1)}`).join('L')
      )
    }
  }
  return parts.join('')
}
