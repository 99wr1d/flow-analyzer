import {
  TOOL_GROUPS,
  useAnnotationsStore,
  type Tool
} from '../features/annotations/annotationsStore'
import { useKeyHint } from '../features/commands/useKeys'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import {
  ArrowToolIcon,
  ChainToolIcon,
  CircleToolIcon,
  CurveToolIcon,
  LineToolIcon,
  LoupeToolIcon,
  PenToolIcon,
  RulerToolIcon,
  SelectIcon,
  SpotlightToolIcon,
  TextToolIcon,
  ZoneToolIcon
} from '../ui/icons'
import { useCalibrationsStore } from '../features/pitch/calibrationsStore'

const ICONS: Record<Tool, () => React.JSX.Element> = {
  select: () => <SelectIcon size={20} />,
  arrow: () => <ArrowToolIcon size={20} />,
  line: () => <LineToolIcon size={20} />,
  circle: () => <CircleToolIcon size={20} />,
  text: () => <TextToolIcon size={20} />,
  ruler: () => <RulerToolIcon size={20} />,
  spot: () => <SpotlightToolIcon size={20} />,
  curve: () => <CurveToolIcon size={20} />,
  pen: () => <PenToolIcon size={20} />,
  zone: () => <ZoneToolIcon size={20} />,
  loupe: () => <LoupeToolIcon size={20} />,
  chain: () => <ChainToolIcon size={20} />
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

/** Рейка инструментов: три группы (основные, поле и анализ, дополнительные) с разделителями. */
export function ToolRail(): React.JSX.Element {
  return (
    <nav className="tool-rail" aria-label={ru.toolRail.label} data-testid="tool-rail">
      {TOOL_GROUPS.map((group, i) => (
        <div
          key={group.id}
          className={i === 0 ? 'tool-group' : 'tool-group tool-group--sep'}
          role="group"
          aria-label={ru.toolRail.groups[group.id]}
          data-testid={`tool-group-${group.id}`}
        >
          {group.tools.map((tool) => (
            <ToolButton key={tool} tool={tool} />
          ))}
        </div>
      ))}
    </nav>
  )
}
