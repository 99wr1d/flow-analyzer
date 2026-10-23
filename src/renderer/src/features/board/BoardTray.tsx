// Ряд под полем: кисть цвета и элементы выбранного раздела (позы, предметы, виды стрелок, карандаш, зоны).
import type { JSX } from 'react'
import { EQUIPMENT_IDS, FIGURE_POSES, type FigureSet } from '../../../../shared/board/ids'
import type { BoardElement } from '../../../../shared/board/schema'
import { ru } from '../../i18n/ru'
import { nextNumber } from './boardDraw'
import { useBoardStore, type BoardDraw, type BoardSection, type BoardTool } from './boardStore'
import { DEFAULT_BRUSH, useBoardUi } from './boardUi'
import { ColorPicker } from './ColorPicker'
import {
  DEFAULT_EQUIP_COLOR,
  EQUIP_HALF_WIDTH,
  EQUIP_HEIGHT,
  EQUIPMENT_LABEL,
  EquipmentArt
} from './art/equipment'
import { FigureArt, poseLabel } from './art/figureArt'
import { DEFAULT_COLOR } from './art/figures/kit'

interface TrayItem {
  key: string
  label: string
  tool: BoardTool
  icon: JSX.Element
}

const LYING = ['dive-low', 'dive-high', 'smother']
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const DRAWS: Partial<Record<BoardSection, BoardDraw[]>> = {
  arrows: ['arrow', 'line', 'arrow-dashed', 'curve', 'wavy'],
  pencil: ['pen', 'pen-dashed'],
  text: ['text'],
  zones: ['hatch-rect', 'hatch-tri', 'hatch-ellipse', 'line']
}

function DrawIcon({ draw, color }: { draw: BoardDraw; color: string }): JSX.Element {
  const s = { stroke: color, strokeWidth: 3, fill: 'none', strokeLinecap: 'round' as const }
  const head = <path d="M40 8 L44 4 L36 4 Z" fill={color} stroke={color} strokeWidth={2} />
  let body: JSX.Element
  switch (draw) {
    case 'arrow':
      body = (
        <>
          <path d="M8 28 L41 6" {...s} />
          {head}
        </>
      )
      break
    case 'arrow-dashed':
      body = (
        <>
          <path d="M8 28 L41 6" {...s} strokeDasharray="5 4" />
          {head}
        </>
      )
      break
    case 'line':
      body = <path d="M8 28 L44 6" {...s} />
      break
    case 'curve':
      body = (
        <>
          <path d="M8 28 Q12 4 40 6" {...s} />
          <path d="M44 6 L37 1 L37 11 Z" fill={color} stroke={color} strokeWidth={1.5} />
        </>
      )
      break
    case 'wavy':
      body = (
        <>
          <path d="M6 18 q4 -8 8 0 t8 0 t8 0 t6 0" {...s} />
          <path d="M44 18 L37 13 L37 23 Z" fill={color} stroke={color} strokeWidth={1.5} />
        </>
      )
      break
    case 'pen':
      body = <path d="M6 26 C14 4 22 30 30 14 S40 8 44 10" {...s} />
      break
    case 'pen-dashed':
      body = <path d="M6 26 C14 4 22 30 30 14 S40 8 44 10" {...s} strokeDasharray="5 4" />
      break
    case 'text':
      body = (
        <text x="25" y="25" textAnchor="middle" fontSize="20" fontWeight="700" fill={color}>
          Aa
        </text>
      )
      break
    case 'hatch-rect':
      body = (
        <rect x="9" y="6" width="32" height="22" {...s} strokeWidth={2.5} fill={`${color}55`} />
      )
      break
    case 'hatch-tri':
      body = <path d="M25 5 L42 29 L8 29 Z" {...s} strokeWidth={2.5} fill={`${color}55`} />
      break
    case 'hatch-ellipse':
      body = (
        <ellipse cx="25" cy="17" rx="17" ry="12" {...s} strokeWidth={2.5} fill={`${color}55`} />
      )
      break
  }
  return (
    <svg viewBox="0 0 50 34" width={50} height={34} aria-hidden="true">
      {body}
    </svg>
  )
}

function figureItems(set: FigureSet, color: string): TrayItem[] {
  return FIGURE_POSES[set].map((pose) => {
    const el: BoardElement = {
      kind: 'figure',
      set,
      pose,
      facing: 'front',
      pos: { x: 0.5, y: 0.5 },
      scale: 1,
      rotation: 0,
      color
    }
    const wide = LYING.includes(pose)
    return {
      key: pose,
      label: capital(poseLabel(set, pose)),
      tool: { kind: 'place', el },
      icon: (
        <svg
          viewBox={wide ? '-130 -105 260 115' : '-62 -212 124 220'}
          width={60}
          height={52}
          aria-hidden="true"
        >
          <FigureArt set={set} pose={pose} facing="front" color={color} />
        </svg>
      )
    }
  })
}

function itemsFor(section: BoardSection, brush: string | null, nextN: number): TrayItem[] {
  switch (section) {
    case 'gk':
    case 'player':
    case 'coach':
      return figureItems(section, brush ?? DEFAULT_COLOR[section])
    case 'equipment':
      return EQUIPMENT_IDS.map((item) => {
        const color = brush ?? DEFAULT_EQUIP_COLOR[item]
        const hw = EQUIP_HALF_WIDTH[item] * 1.25
        const h = EQUIP_HEIGHT[item] * 1.25
        return {
          key: item,
          label: EQUIPMENT_LABEL[item],
          tool: {
            kind: 'place',
            el: { kind: 'equip', item, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, color }
          },
          icon: (
            <svg
              viewBox={`${-Math.max(hw, h * 0.7)} ${-h} ${2 * Math.max(hw, h * 0.7)} ${h * 1.15}`}
              width={50}
              height={50}
              aria-hidden="true"
            >
              <EquipmentArt item={item} color={color} />
            </svg>
          )
        }
      })
    case 'tokens': {
      const color = brush ?? '#e53935'
      return [
        {
          key: 'token',
          label: ru.board.token,
          tool: {
            kind: 'place',
            el: { kind: 'token', pos: { x: 0.5, y: 0.5 }, scale: 1, color, label: '' }
          },
          icon: (
            <svg viewBox="0 0 50 50" width={50} height={50} aria-hidden="true">
              <circle cx="25" cy="25" r="15" fill={color} stroke="#ffffff" strokeWidth="3" />
            </svg>
          )
        }
      ]
    }
    case 'numbers': {
      const color = brush ?? '#1a1a1a'
      return [
        {
          key: 'number',
          label: ru.board.numberNext(nextN),
          tool: {
            kind: 'place',
            el: { kind: 'number', pos: { x: 0.5, y: 0.5 }, scale: 1, color, n: 1 }
          },
          icon: (
            <svg viewBox="0 0 50 50" width={50} height={50} aria-hidden="true">
              <circle cx="25" cy="25" r="15" fill="#ffffff" stroke="#1c2026" strokeWidth="3" />
              <text x="25" y="31" textAnchor="middle" fontSize="17" fontWeight="800" fill={color}>
                {nextN}
              </text>
            </svg>
          )
        }
      ]
    }
    default: {
      const color = brush ?? '#ffffff'
      return (DRAWS[section] ?? []).map((draw) => ({
        key: draw,
        label: ru.board.draw[draw],
        tool: { kind: 'draw', draw },
        icon: <DrawIcon draw={draw} color={color} />
      }))
    }
  }
}

function sameTool(a: BoardTool, b: BoardTool): boolean {
  if (a.kind === 'draw' && b.kind === 'draw') return a.draw === b.draw
  if (a.kind !== 'place' || b.kind !== 'place') return false
  const x = a.el
  const y = b.el
  if (x.kind === 'figure' && y.kind === 'figure') return x.set === y.set && x.pose === y.pose
  if (x.kind === 'equip' && y.kind === 'equip') return x.item === y.item
  return x.kind === y.kind
}

export function BoardTray(): JSX.Element {
  const section = useBoardStore((s) => s.section)
  const tool = useBoardStore((s) => s.tool)
  const playing = useBoardStore((s) => s.playing)
  const nextN = useBoardStore((s) => (s.board ? nextNumber(s.board) : 1))
  const chosen = useBoardUi((s) => s.brush[section])
  const brush = chosen ?? DEFAULT_BRUSH[section]
  const items = itemsFor(section, brush, nextN)
  const figure = section === 'gk' || section === 'player' || section === 'coach'
  const shownBrush = brush ?? (figure ? DEFAULT_COLOR[section] : null)
  return (
    <div
      className="board-tray"
      role="toolbar"
      aria-label={ru.board.trayLabel}
      data-testid="board-tray"
    >
      <ColorPicker
        value={shownBrush}
        label={ru.board.brush}
        title={ru.board.brushTitle}
        testId="board-brush"
        disabled={playing}
        onChange={(c) => {
          useBoardUi.getState().setBrush(section, c)
          // Выбранный элемент раздела перекрашивается сразу (ставится уже новым цветом).
          const t = useBoardStore.getState().tool
          if (t.kind === 'place' && 'color' in t.el)
            useBoardStore.getState().setTool({ kind: 'place', el: { ...t.el, color: c } })
        }}
      />
      <div className="board-tray__sep" aria-hidden="true" />
      <div className="board-tray__items">
        {items.map((it) => {
          const active = sameTool(tool, it.tool)
          return (
            <button
              key={it.key}
              type="button"
              className={active ? 'board-tray__item board-tray__item--active' : 'board-tray__item'}
              aria-pressed={active}
              title={it.label}
              disabled={playing}
              data-testid={`board-tray-${it.key}`}
              onClick={(e) => {
                useBoardStore.getState().setTool(it.tool)
                useBoardUi.getState().setHand(false)
                e.currentTarget.blur()
              }}
            >
              <span className="board-tray__icon">{it.icon}</span>
              <span className="board-tray__label">{it.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
