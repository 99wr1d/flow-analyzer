import { useEffect, useRef, useState } from 'react'
import { MAX_TEXT_LENGTH, type TextStyle } from '../../../../shared/annotations'
import { ru } from '../../i18n/ru'
import { isDarkColor } from './styles'
import { TEXT_FONT_FAMILY, measureTextWidth, textFontWeight } from './textMetrics'

interface Props {
  /** Левый верхний угол в пикселях контейнера. */
  x: number
  y: number
  style: TextStyle
  /** Высота видео в пикселях: размер шрифта = style.size * videoHeight. */
  videoHeight: number
  initial: string
  onCommit: (text: string) => void
  onCancel: () => void
}

/** Поле ввода подписи прямо на картинке. Enter — готово, Esc — отмена, потеря фокуса — готово. */
export function TextEditor({
  x,
  y,
  style,
  videoHeight,
  initial,
  onCommit,
  onCancel
}: Props): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const [value, setValue] = useState(initial)
  const font = style.size * videoHeight
  const pad = font * 0.3
  const dark = isDarkColor(style.color)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(value)
    else onCancel()
  }

  const width = Math.max(font * 4, measureTextWidth(value || ' ', font) + font)

  return (
    <input
      ref={ref}
      type="text"
      className="anno-text-input"
      data-testid="annotation-text-input"
      aria-label={ru.annotations.textInput}
      placeholder={ru.annotations.textPlaceholder}
      maxLength={MAX_TEXT_LENGTH}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      style={{
        left: x,
        top: y,
        width: width + pad * 2,
        height: font * 1.2 + pad * 2,
        padding: `0 ${pad}px`,
        fontSize: font,
        fontFamily: TEXT_FONT_FAMILY,
        fontWeight: textFontWeight(style.shadow),
        color: style.color,
        background: style.background
          ? dark
            ? 'rgba(255,255,255,0.88)'
            : 'rgba(10,12,16,0.68)'
          : 'rgba(10,12,16,0.35)',
        borderRadius: font * 0.2
      }}
    />
  )
}
