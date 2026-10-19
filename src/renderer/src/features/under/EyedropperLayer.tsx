// Пипетка: пока она включена, поверх картинки лежит прозрачный слой; щелчок берёт цвет газона из кадра видео.
import { ru } from '../../i18n/ru'
import type { Rect } from '../annotations/geometry'
import { useFeedbackStore } from '../episodes/feedbackStore'
import { getVideoElement } from '../player/videoElement'
import { useGrassStore } from './grassStore'
import { pickVideoColor } from './sampleVideo'

export function EyedropperLayer({ rect }: { rect: Rect }): React.JSX.Element | null {
  const active = useGrassStore((s) => s.eyedropper)
  if (!active) return null
  return (
    <div
      className="anno-eyedropper"
      data-testid="eyedropper-layer"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const box = e.currentTarget.getBoundingClientRect()
        const video = getVideoElement()
        const color = video
          ? pickVideoColor(
              video,
              (e.clientX - box.left) / box.width,
              (e.clientY - box.top) / box.height
            )
          : null
        if (color) useGrassStore.getState().pickColor(color)
        else useFeedbackStore.getState().show({ text: ru.grass.samplingFailed, kind: 'warn' })
      }}
    >
      <span className="anno-eyedropper__hint">{ru.grass.eyedropperActive}</span>
    </div>
  )
}

/** Пока показана маска газона, в углу картинки висит плашка: так маску не забудут выключить. */
export function MaskBadge({ rect }: { rect: Rect }): React.JSX.Element | null {
  const on = useGrassStore((s) => s.maskView)
  if (!on) return null
  return (
    <button
      type="button"
      className="anno-mask-badge"
      data-testid="mask-badge"
      title={ru.grass.maskBadgeHint}
      style={{ left: rect.x + 8, top: rect.y + 8 }}
      onClick={(e) => {
        useGrassStore.getState().setMaskView(false)
        e.currentTarget.blur()
      }}
    >
      {ru.grass.maskBadge}
    </button>
  )
}
