// Левая колонка доски: разделы (Инвентарь, Вратари, … Зоны). Щелчок открывает раздел и берёт его первый элемент.
import type { JSX } from 'react'
import { ru } from '../../i18n/ru'
import { useBoardStore, type BoardSection } from './boardStore'
import { useBoardUi } from './boardUi'

const BOARD_SECTIONS: readonly BoardSection[] = [
  'equipment',
  'gk',
  'player',
  'coach',
  'tokens',
  'arrows',
  'pencil',
  'text',
  'numbers',
  'zones'
]

export function BoardRail(): JSX.Element {
  const section = useBoardStore((s) => s.section)
  const playing = useBoardStore((s) => s.playing)
  return (
    <nav className="board-rail" aria-label={ru.board.sectionsLabel} data-testid="board-rail">
      {BOARD_SECTIONS.map((id) => {
        const active = id === section
        return (
          <button
            key={id}
            type="button"
            className={active ? 'board-rail__btn board-rail__btn--active' : 'board-rail__btn'}
            aria-pressed={active}
            disabled={playing}
            data-testid={`board-section-${id}`}
            onClick={(e) => {
              if (!active || useBoardStore.getState().tool.kind === 'select') {
                useBoardStore.getState().setSection(id)
                useBoardUi.getState().setHand(false)
              }
              e.currentTarget.blur()
            }}
          >
            {ru.board.sections[id]}
          </button>
        )
      })}
    </nav>
  )
}
