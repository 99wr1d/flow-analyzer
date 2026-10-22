// Прожектор: освещённые области из списка рисунков.
import { isPitchAnnotation, spotDim, type Annotation } from '../../../../shared/annotations'
import type { Projector } from '../../../../shared/pitch/projector'
import { paintPitch } from '../../../../shared/pitch/shapes'
import { paintScreenTool } from '../../../../shared/tools/screenPaint'
import type { SpotInput } from '../../../../shared/tools/spotlight'
import type { Size } from './geometry'
import { measureTextWidth } from './textMetrics'

export type ProjectorOf = (calibrationId: string) => Projector | null | undefined

/** Освещённые области прожекторов из списка рисунков (остальные виды пропускаются). */
export function spotInputs(
  items: readonly Annotation[],
  size: Size,
  projectorOf: ProjectorOf
): SpotInput[] {
  const out: SpotInput[] = []
  for (const a of items) {
    if (a.type === 'spot') {
      out.push({ dim: spotDim(a), lit: paintScreenTool(a, size).lit })
    } else if (a.type === 'pspot' && isPitchAnnotation(a)) {
      const proj = projectorOf(a.calibrationId)
      if (proj) out.push({ dim: spotDim(a), lit: paintPitch(a, proj, size, measureTextWidth).lit })
    }
  }
  return out
}
