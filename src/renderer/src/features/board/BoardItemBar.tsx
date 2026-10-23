// Панель над полем: свойства выбранного (сторона, поза, цвет, появление по кадрам, порядок) или подсказка инструмента.
import type { JSX } from 'react'
import { FACINGS, FIGURE_POSES, type Facing } from '../../../../shared/board/ids'
import {
  bringToFront,
  hideFrom,
  sendToBack,
  setFacing,
  setPose,
  setShow,
  setStyle
} from '../../../../shared/board/edit'
import { elementAt, visibleAt } from '../../../../shared/board/resolve'
import type { Board, BoardItem } from '../../../../shared/board/schema'
import { ru } from '../../i18n/ru'
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '../../ui/icons'
import { applyBoard, deleteSelected } from './boardActions'
import { useBoardStore, type BoardTool } from './boardStore'
import { useBoardUi } from './boardUi'
import { ColorPicker } from './ColorPicker'
import { poseLabel } from './art/figureArt'

/** Стрелка направления на экране: лицом — вниз (к нам), спиной — вверх. */
const FACING_ARROW: Record<Facing, string> = {
  front: '↓',
  'front-right': '↘',
  right: '→',
  'back-right': '↗',
  back: '↑',
  'back-left': '↖',
  left: '←',
  'front-left': '↙'
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function colorOf(item: BoardItem): string {
  const el = item.el
  return el.kind === 'shape' ? el.ann.style.color : el.color
}

function hint(tool: BoardTool, hand: boolean, playing: boolean): string {
  const h = ru.board.hint
  if (playing) return h.playing
  if (hand) return h.hand
  if (tool.kind === 'select') return h.select
  if (tool.kind === 'place') return h.place
  switch (tool.draw) {
    case 'curve':
      return h.curve
    case 'pen':
    case 'pen-dashed':
      return h.pen
    case 'text':
      return h.text
    case 'hatch-rect':
    case 'hatch-tri':
    case 'hatch-ellipse':
      return h.zone
    default:
      return h.line
  }
}

/** Применяет правку ко всем выбранным. */
function each(ids: string[], fn: (b: Board, id: string) => Board): void {
  applyBoard((b) => ids.reduce(fn, b))
}

function FigureControls({ item, frame }: { item: BoardItem; frame: number }): JSX.Element | null {
  const el = elementAt(item, frame)
  if (el.kind !== 'figure') return null
  const id = item.id
  return (
    <>
      <div className="board-bar__group" role="radiogroup" aria-label={ru.board.item.facing}>
        <span className="board-bar__caption">{ru.board.item.facing}</span>
        <div className="board-facing">
          {FACINGS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={el.facing === f}
              className={
                el.facing === f
                  ? 'board-facing__btn board-facing__btn--active'
                  : 'board-facing__btn'
              }
              title={ru.board.facings[f]}
              aria-label={ru.board.facings[f]}
              data-testid={`board-facing-${f}`}
              onClick={() => applyBoard((b) => setFacing(b, id, frame, f))}
            >
              {FACING_ARROW[f]}
            </button>
          ))}
        </div>
      </div>
      <label className="board-bar__group">
        <span className="board-bar__caption">{ru.board.item.pose}</span>
        <select
          className="select"
          value={el.pose}
          data-testid="board-pose"
          onChange={(e) => {
            const pose = e.target.value
            applyBoard((b) => setPose(b, id, frame, pose))
          }}
        >
          {FIGURE_POSES[el.set].map((p) => (
            <option key={p} value={p}>
              {capital(poseLabel(el.set, p))}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

function TokenControls({ item }: { item: BoardItem }): JSX.Element | null {
  const el = item.el
  const id = item.id
  if (el.kind === 'token')
    return (
      <label className="board-bar__group" title={ru.board.item.tokenLabelTitle}>
        <span className="board-bar__caption">{ru.board.item.tokenLabel}</span>
        <input
          className="input board-bar__short"
          maxLength={2}
          defaultValue={el.label}
          key={`${id}-${el.label}`}
          data-testid="board-token-label"
          onBlur={(e) => {
            const label = e.target.value.trim().slice(0, 2)
            if (label !== el.label) applyBoard((b) => setStyle(b, id, { label }))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
    )
  if (el.kind === 'number')
    return (
      <label className="board-bar__group">
        <span className="board-bar__caption">{ru.board.item.number}</span>
        <input
          className="input board-bar__short"
          type="number"
          min={1}
          max={99}
          defaultValue={el.n}
          key={`${id}-${el.n}`}
          data-testid="board-number"
          onBlur={(e) => {
            const n = Math.round(Number(e.target.value))
            if (Number.isFinite(n) && n >= 1 && n <= 99 && n !== el.n)
              applyBoard((b) => setStyle(b, id, { n }))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>
    )
  return null
}

export function BoardItemBar(): JSX.Element | null {
  const board = useBoardStore((s) => s.board)
  const frame = useBoardStore((s) => s.frame)
  const selection = useBoardStore((s) => s.selection)
  const tool = useBoardStore((s) => s.tool)
  const playing = useBoardStore((s) => s.playing)
  const hand = useBoardUi((s) => s.hand)
  if (!board) return null
  const items = selection
    .map((id) => board.items.find((i) => i.id === id))
    .filter((i): i is BoardItem => !!i)

  if (items.length === 0 || playing)
    return (
      <div className="board-bar board-bar--hint" data-testid="board-hint">
        {hint(tool, hand, playing)}
      </div>
    )

  const ids = items.map((i) => i.id)
  const single = items.length === 1 ? items[0] : null
  const visible = items.every((i) => visibleAt(i, frame))
  const anyVisible = items.some((i) => visibleAt(i, frame))
  // «Показать с этого кадра» меняет что-то, если элемент здесь не виден или появляется раньше.
  const canShow = items.some((i) => !visibleAt(i, frame) || i.show.from !== frame)
  const color = colorOf(items[0])

  return (
    <div
      className="board-bar"
      role="toolbar"
      aria-label={ru.board.item.label}
      data-testid="board-item-bar"
    >
      {single && visible && <FigureControls item={single} frame={frame} />}
      {single && <TokenControls item={single} />}
      {!single && (
        <span className="board-bar__caption">{ru.board.item.selected(items.length)}</span>
      )}
      <div className="board-bar__group">
        <ColorPicker
          value={color}
          label={ru.board.item.color}
          title={ru.board.item.color}
          testId="board-item-color"
          onChange={(c) => each(ids, (b, id) => setStyle(b, id, { color: c }))}
        />
      </div>
      <div className="board-bar__sep" aria-hidden="true" />
      {!visible && <span className="board-bar__note">{ru.board.item.hiddenHere}</span>}
      <button
        type="button"
        className="btn btn--small"
        disabled={!anyVisible}
        title={ru.board.item.hideFromTitle}
        data-testid="board-hide-from"
        onClick={() =>
          each(ids, (b, id) =>
            visibleAt(
              b.items.find((i) => i.id === id)!,
              frame
            )
              ? hideFrom(b, id, frame)
              : b
          )
        }
      >
        {ru.board.item.hideFrom}
      </button>
      <button
        type="button"
        className="btn btn--small"
        disabled={!canShow}
        title={ru.board.item.showFromTitle}
        data-testid="board-show-from"
        onClick={() =>
          each(ids, (b, id) => {
            const it = b.items.find((i) => i.id === id)!
            const to = it.show.to >= frame ? it.show.to : b.frameCount - 1
            return setShow(b, id, frame, to)
          })
        }
      >
        {ru.board.item.showFrom}
      </button>
      <div className="board-bar__sep" aria-hidden="true" />
      <button
        type="button"
        className="btn btn--small"
        title={ru.board.item.frontTitle}
        data-testid="board-to-front"
        onClick={() => each(ids, bringToFront)}
      >
        <ArrowUpIcon size={14} />
        {ru.board.item.front}
      </button>
      <button
        type="button"
        className="btn btn--small"
        title={ru.board.item.backTitle}
        data-testid="board-to-back"
        onClick={() => each([...ids].reverse(), sendToBack)}
      >
        <ArrowDownIcon size={14} />
        {ru.board.item.back}
      </button>
      <div className="board-bar__spacer" />
      <button
        type="button"
        className="icon-btn"
        title={ru.board.item.delete}
        aria-label={ru.board.item.delete}
        data-testid="board-delete"
        onClick={deleteSelected}
      >
        <TrashIcon size={16} />
      </button>
    </div>
  )
}
