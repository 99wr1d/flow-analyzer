import { TOOLS, useAnnotationsStore, type Tool } from '../features/annotations/annotationsStore'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import { ArrowToolIcon, CircleToolIcon, LineToolIcon, SelectIcon, TextToolIcon } from '../ui/icons'

const ICONS: Record<Tool, () => React.JSX.Element> = {
  select: () => <SelectIcon size={20} />,
  arrow: () => <ArrowToolIcon size={20} />,
  line: () => <LineToolIcon size={20} />,
  circle: () => <CircleToolIcon size={20} />,
  text: () => <TextToolIcon size={20} />
}

export function ToolRail(): React.JSX.Element {
  const ready = usePlayerStore((s) => s.status === 'ready')
  const active = useAnnotationsStore((s) => s.tool)
  const setTool = useAnnotationsStore((s) => s.setTool)
  return (
    <nav className="tool-rail" aria-label={ru.toolRail.label}>
      {TOOLS.map((tool) => (
        <button
          key={tool}
          type="button"
          className={active === tool ? 'tool-btn tool-btn--active' : 'tool-btn'}
          disabled={!ready}
          aria-pressed={active === tool}
          title={ru.toolRail[tool]}
          aria-label={ru.toolRail[tool]}
          data-testid={`tool-${tool}`}
          onClick={(e) => {
            setTool(tool)
            e.currentTarget.blur()
          }}
        >
          {ICONS[tool]()}
        </button>
      ))}
    </nav>
  )
}
