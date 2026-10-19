import { TOOLS, useAnnotationsStore, type Tool } from '../features/annotations/annotationsStore'
import { useKeyHint } from '../features/commands/useKeys'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import {
  ArrowToolIcon,
  CircleToolIcon,
  LineToolIcon,
  RulerToolIcon,
  SelectIcon,
  TextToolIcon
} from '../ui/icons'
import { useCalibrationsStore } from '../features/pitch/calibrationsStore'

const ICONS: Record<Tool, () => React.JSX.Element> = {
  select: () => <SelectIcon size={20} />,
  arrow: () => <ArrowToolIcon size={20} />,
  line: () => <LineToolIcon size={20} />,
  circle: () => <CircleToolIcon size={20} />,
  text: () => <TextToolIcon size={20} />,
  ruler: () => <RulerToolIcon size={20} />
}

function ToolButton({ tool }: { tool: Tool }): React.JSX.Element {
  const ready = usePlayerStore((s) => s.status === 'ready')
  const active = useAnnotationsStore((s) => s.tool === tool)
  const setTool = useAnnotationsStore((s) => s.setTool)
  const hasCalibration = useCalibrationsStore((s) => s.items.length > 0)
  const needsPitch = tool === 'ruler' && !hasCalibration
  const label = `${ru.toolRail[tool]}${useKeyHint(`draw:${tool}`)}${needsPitch ? ` — ${ru.pitch.needCalibration}` : ''}`
  return (
    <button
      type="button"
      className={active ? 'tool-btn tool-btn--active' : 'tool-btn'}
      disabled={!ready || needsPitch}
      aria-pressed={active}
      title={label}
      aria-label={label}
      data-testid={`tool-${tool}`}
      onClick={(e) => {
        setTool(tool)
        e.currentTarget.blur()
      }}
    >
      {ICONS[tool]()}
    </button>
  )
}

export function ToolRail(): React.JSX.Element {
  return (
    <nav className="tool-rail" aria-label={ru.toolRail.label}>
      {TOOLS.map((tool) => (
        <ToolButton key={tool} tool={tool} />
      ))}
    </nav>
  )
}
