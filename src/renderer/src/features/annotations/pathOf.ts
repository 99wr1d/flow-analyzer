import type { PxPt } from '../../../../shared/pitch/shapes'

/** Путь SVG из набора многоугольников (в пикселях). */
export function pathOf(rings: readonly (readonly PxPt[])[]): string {
  return rings
    .map((r) => 'M' + r.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L') + 'Z')
    .join('')
}
