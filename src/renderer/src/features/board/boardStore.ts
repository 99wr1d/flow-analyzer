// Состояние редактора доски тренера: документ, кадр, выделение, инструмент и история правок.
import { create } from 'zustand'
import { EQUIPMENT_IDS, FIGURE_POSES } from '../../../../shared/board/ids'
import type { FigureSet } from '../../../../shared/board/ids'
import type { Board, BoardElement } from '../../../../shared/board/schema'
import { DEFAULT_EQUIP_COLOR } from './art/equipment'
import { DEFAULT_COLOR } from './art/figures/kit'

export type BoardSection =
  | 'equipment'
  | 'gk'
  | 'player'
  | 'coach'
  | 'tokens'
  | 'arrows'
  | 'pencil'
  | 'text'
  | 'numbers'
  | 'zones'

export type BoardDraw =
  | 'arrow'
  | 'line'
  | 'curve'
  | 'arrow-dashed'
  | 'wavy'
  | 'pen'
  | 'pen-dashed'
  | 'text'
  | 'hatch-rect'
  | 'hatch-tri'
  | 'hatch-ellipse'

export type BoardTool =
  { kind: 'select' } | { kind: 'place'; el: BoardElement } | { kind: 'draw'; draw: BoardDraw }

export interface Snapshot {
  board: Board
  frame: number
  selection: string[]
}

export const HISTORY_DEPTH = 100

const CENTER = { x: 0.5, y: 0.5 }

/** Инструмент по умолчанию для раздела палитры. */
export function toolForSection(section: BoardSection): BoardTool {
  switch (section) {
    case 'gk':
    case 'player':
    case 'coach': {
      const set: FigureSet = section
      return {
        kind: 'place',
        el: {
          kind: 'figure',
          set,
          pose: FIGURE_POSES[set][0],
          facing: 'front',
          pos: CENTER,
          scale: 1,
          rotation: 0,
          color: DEFAULT_COLOR[set]
        }
      }
    }
    case 'equipment': {
      const item = EQUIPMENT_IDS[0]
      return {
        kind: 'place',
        el: {
          kind: 'equip',
          item,
          pos: CENTER,
          scale: 1,
          rotation: 0,
          color: DEFAULT_EQUIP_COLOR[item]
        }
      }
    }
    case 'tokens':
      return {
        kind: 'place',
        el: { kind: 'token', pos: CENTER, scale: 1, color: '#e53935', label: '' }
      }
    case 'numbers':
      return {
        kind: 'place',
        el: { kind: 'number', pos: CENTER, scale: 1, color: '#1a1a1a', n: 1 }
      }
    case 'arrows':
      return { kind: 'draw', draw: 'arrow' }
    case 'pencil':
      return { kind: 'draw', draw: 'pen' }
    case 'text':
      return { kind: 'draw', draw: 'text' }
    case 'zones':
      return { kind: 'draw', draw: 'hatch-rect' }
  }
}

interface BoardState {
  board: Board | null
  path: string | null
  dirty: boolean
  frame: number
  section: BoardSection
  tool: BoardTool
  selection: string[]
  playing: boolean
  past: Snapshot[]
  future: Snapshot[]
  load: (board: Board, path: string | null) => void
  reset: () => void
  /** Применяет чистую операцию правки. Возвращает текст ошибки (доска не меняется) или null. */
  apply: (fn: (b: Board) => Board) => string | null
  undo: () => void
  redo: () => void
  setFrame: (n: number) => void
  setSection: (s: BoardSection) => void
  setTool: (t: BoardTool) => void
  select: (ids: string[]) => void
  markSaved: (path: string) => void
  setPlaying: (p: boolean) => void
}

const initial = {
  board: null,
  path: null,
  dirty: false,
  frame: 0,
  section: 'player' as BoardSection,
  tool: { kind: 'select' } as BoardTool,
  selection: [] as string[],
  playing: false,
  past: [] as Snapshot[],
  future: [] as Snapshot[]
}

export const useBoardStore = create<BoardState>()((set, get) => ({
  ...initial,
  load: (board, path) =>
    set({ ...initial, board, path, section: get().section, tool: { kind: 'select' } }),
  reset: () => set({ ...initial }),
  apply: (fn) => {
    const { board, frame, selection, past } = get()
    if (!board) return 'Доска не открыта'
    let next: Board
    try {
      next = fn(board)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    set({
      board: next,
      past: [...past, { board, frame, selection }].slice(-HISTORY_DEPTH),
      future: [],
      dirty: true
    })
    return null
  },
  undo: () => {
    const { board, frame, selection, past, future } = get()
    const prev = past[past.length - 1]
    if (!board || !prev) return
    set({
      ...prev,
      past: past.slice(0, -1),
      future: [...future, { board, frame, selection }],
      dirty: true
    })
  },
  redo: () => {
    const { board, frame, selection, past, future } = get()
    const next = future[future.length - 1]
    if (!board || !next) return
    set({
      ...next,
      future: future.slice(0, -1),
      past: [...past, { board, frame, selection }].slice(-HISTORY_DEPTH),
      dirty: true
    })
  },
  setFrame: (n) => {
    const { board } = get()
    const max = board ? board.frameCount - 1 : 0
    set({ frame: Math.min(Math.max(0, Math.round(n)), max) })
  },
  setSection: (section) => set({ section, tool: toolForSection(section) }),
  setTool: (tool) => set({ tool }),
  select: (selection) => set({ selection }),
  markSaved: (path) => set({ path, dirty: false }),
  setPlaying: (playing) => set({ playing })
}))
