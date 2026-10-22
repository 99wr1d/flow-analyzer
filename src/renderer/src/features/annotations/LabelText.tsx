// Буквы подписи: текст рисунка на экране и на поле. Один код для обоих и для экспорта.
import { textShadowLayers } from '../../../../shared/styleFx'
import { isDarkColor } from './styles'
import { TEXT_FONT_FAMILY, textFontWeight } from './textMetrics'

interface LabelTextProps {
  text: string
  x: number
  y: number
  fontPx: number
  color: string
  /** Плашка под текстом есть: контур и тень не нужны. */
  plate: boolean
  /** Тень подписи (поле стиля shadow). Нет поля (старая подпись без плашки) — прежний контур. */
  shadow?: boolean
  anchor?: 'start' | 'middle'
}

/** Общие свойства текста подписи. */
const common = (
  fontPx: number,
  anchor: 'start' | 'middle',
  weight: number
): React.SVGProps<SVGTextElement> => ({
  fontSize: fontPx,
  fontFamily: TEXT_FONT_FAMILY,
  fontWeight: weight,
  dominantBaseline: 'central',
  textAnchor: anchor
})

export function LabelText({
  text,
  x,
  y,
  fontPx,
  color,
  plate,
  shadow,
  anchor = 'start'
}: LabelTextProps): React.JSX.Element {
  const dark = isDarkColor(color)
  const props = common(fontPx, anchor, textFontWeight(shadow))
  if (!plate && shadow === true) {
    // Без плашки: подпись читается на траве благодаря тонкой тени под буквами (светлому тексту — тёмной, тёмному — светлой).
    const ink = dark ? '255,255,255' : '0,0,0'
    return (
      <>
        {textShadowLayers(fontPx).map((l, i) => (
          <text
            key={i}
            data-part="text-shadow"
            x={x}
            y={y + l.dy}
            {...props}
            fill={`rgb(${ink})`}
            fillOpacity={l.opacity}
            stroke={`rgb(${ink})`}
            strokeOpacity={l.opacity}
            strokeWidth={l.width}
            strokeLinejoin="round"
          >
            {text}
          </text>
        ))}
        <text data-part="text" x={x} y={y} {...props} fill={color}>
          {text}
        </text>
      </>
    )
  }
  // Старая подпись без плашки и без поля shadow — прежний контур; shadow === false — голый текст.
  const outline = !plate && shadow === undefined
  return (
    <text
      data-part="text"
      x={x}
      y={y}
      {...props}
      fill={color}
      stroke={outline ? (dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)') : undefined}
      strokeWidth={outline ? fontPx * 0.14 : undefined}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {text}
    </text>
  )
}
