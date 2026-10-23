/** Чистые операции правки доски: каждая возвращает новую Board, вход не меняется; ошибки входа — throw. */
import { FACINGS, FIGURE_POSES, PITCH_VIEW_IDS } from './ids'
import type { Facing, PitchViewId } from './ids'
import { elementAt } from './resolve'
import {
  BoardElementSchema,
  GEOM_KEYS,
  MAX_FRAMES,
  MAX_ITEMS,
  MAX_TITLE,
  MAX_TRANSITION,
  MIN_TRANSITION,
  shapeGeomKeys
} from './schema'
import type { Board, BoardElement, BoardItem, BoardState } from './schema'

type Rec = Record<string, unknown>

function geomKeys(el: BoardElement): readonly string[] {
  return el.kind === 'shape' ? shapeGeomKeys(el.ann.type) : GEOM_KEYS[el.kind]
}

function find(b: Board, id: string): BoardItem {
  const it = b.items.find((i) => i.id === id)
  if (!it) throw new Error(`Нет элемента ${id}`)
  return it
}

const replaceItem = (b: Board, id: string, next: BoardItem): Board => ({
  ...b,
  items: b.items.map((i) => (i.id === id ? next : i))
})

function checkFrame(b: Board, frame: number): void {
  if (!Number.isInteger(frame) || frame < 0 || frame >= b.frameCount)
    throw new Error(`Кадр ${frame} вне доски`)
}

function checkEditable(b: Board, it: BoardItem, frame: number): void {
  checkFrame(b, frame)
  if (frame < it.show.from) throw new Error(`Кадр ${frame} раньше появления элемента`)
}

/** Вставляет/объединяет состояние кадра frame (только переданные поля). */
function upsertState(
  states: BoardState[],
  frame: number,
  patch: Omit<BoardState, 'frame'>
): BoardState[] {
  const cur = states.find((s) => s.frame === frame)
  const merged: BoardState = { ...cur, frame }
  if (patch.geom) merged.geom = { ...cur?.geom, ...patch.geom }
  if (patch.pose !== undefined) merged.pose = patch.pose
  if (patch.facing !== undefined) merged.facing = patch.facing
  const rest = states.filter((s) => s.frame !== frame)
  return [...rest, merged].sort((a, c) => a.frame - c.frame)
}

export function addItem(b: Board, el: BoardElement, frame: number, id: string): Board {
  checkFrame(b, frame)
  if (b.items.some((i) => i.id === id)) throw new Error(`Элемент ${id} уже есть`)
  if (b.items.length >= MAX_ITEMS) throw new Error('Слишком много элементов')
  const item: BoardItem = { id, show: { from: frame, to: b.frameCount - 1 }, el, states: [] }
  return { ...b, items: [...b.items, item] }
}

export function editGeom(b: Board, id: string, frame: number, geom: Rec): Board {
  const it = find(b, id)
  checkEditable(b, it, frame)
  const allowed = geomKeys(it.el)
  for (const k of Object.keys(geom))
    if (!allowed.includes(k)) throw new Error(`Поле ${k} не геометрия для ${it.el.kind}`)
  if (frame === it.show.from) {
    const el =
      it.el.kind === 'shape'
        ? ({ ...it.el, ann: { ...it.el.ann, ...geom } } as BoardElement)
        : ({ ...it.el, ...geom } as BoardElement)
    return replaceItem(b, id, { ...it, el })
  }
  return replaceItem(b, id, { ...it, states: upsertState(it.states, frame, { geom }) })
}

export function setPose(b: Board, id: string, frame: number, pose: string): Board {
  const it = find(b, id)
  if (it.el.kind !== 'figure') throw new Error('Поза только у фигуры')
  if (!FIGURE_POSES[it.el.set].includes(pose)) throw new Error(`Поза ${pose} недоступна`)
  checkEditable(b, it, frame)
  if (frame === it.show.from) return replaceItem(b, id, { ...it, el: { ...it.el, pose } })
  return replaceItem(b, id, { ...it, states: upsertState(it.states, frame, { pose }) })
}

export function setFacing(b: Board, id: string, frame: number, facing: Facing): Board {
  const it = find(b, id)
  if (it.el.kind !== 'figure') throw new Error('Направление только у фигуры')
  if (!FACINGS.includes(facing)) throw new Error(`Нет направления ${facing}`)
  checkEditable(b, it, frame)
  if (frame === it.show.from) return replaceItem(b, id, { ...it, el: { ...it.el, facing } })
  return replaceItem(b, id, { ...it, states: upsertState(it.states, frame, { facing }) })
}

const STYLE_KEYS: Record<Exclude<BoardElement['kind'], 'shape'>, readonly string[]> = {
  figure: ['color'],
  equip: ['color'],
  token: ['color', 'label'],
  number: ['color', 'n'],
  wavy: ['color', 'width'],
  hatch: ['color']
}
const SHAPE_STYLE_KEYS = ['color', 'width', 'dash', 'size', 'background', 'shadow']

/** Стиль не анимируется: меняет el и не трогает состояния. */
export function setStyle(b: Board, id: string, patch: Rec): Board {
  const it = find(b, id)
  let el: BoardElement
  if (it.el.kind === 'shape') {
    const ann: Rec = { ...it.el.ann }
    const style: Rec = { ...(ann.style as Rec) }
    for (const [k, v] of Object.entries(patch)) {
      if (SHAPE_STYLE_KEYS.includes(k)) style[k] = v
      else if (k === 'text' && it.el.ann.type === 'text') ann.text = v
      else throw new Error(`Поле ${k} не стиль для shape`)
    }
    ann.style = style
    el = { ...it.el, ann } as BoardElement
  } else {
    const allowed = STYLE_KEYS[it.el.kind]
    for (const k of Object.keys(patch))
      if (!allowed.includes(k)) throw new Error(`Поле ${k} не стиль для ${it.el.kind}`)
    el = { ...it.el, ...patch } as BoardElement
  }
  const r = BoardElementSchema.safeParse(el)
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'Некорректный стиль')
  return replaceItem(b, id, { ...it, el })
}

export function setShow(b: Board, id: string, from: number, to: number): Board {
  const it = find(b, id)
  checkFrame(b, from)
  checkFrame(b, to)
  if (to < from) throw new Error('to меньше from')
  // Состояния с frame <= from сливаются в базу; при from <= show.from база не меняется.
  const el = from > it.show.from ? elementAt(it, from) : it.el
  const states = it.states.filter((s) => s.frame > from)
  return replaceItem(b, id, { ...it, el, show: { from, to }, states })
}

export function hideFrom(b: Board, id: string, frame: number): Board {
  const it = find(b, id)
  if (frame <= it.show.from) return deleteItem(b, id)
  return setShow(b, id, it.show.from, frame - 1)
}

export function deleteItem(b: Board, id: string): Board {
  find(b, id)
  return { ...b, items: b.items.filter((i) => i.id !== id) }
}

export function bringToFront(b: Board, id: string): Board {
  const it = find(b, id)
  return { ...b, items: [...b.items.filter((i) => i.id !== id), it] }
}

export function sendToBack(b: Board, id: string): Board {
  const it = find(b, id)
  return { ...b, items: [it, ...b.items.filter((i) => i.id !== id)] }
}

/** Вставляет кадр after+1 — копию кадра after (в том числе видимость). */
export function addFrame(b: Board, after: number): Board {
  if (b.frameCount >= MAX_FRAMES) throw new Error('Достигнут предел кадров')
  checkFrame(b, after)
  const items = b.items.map((it) => ({
    ...it,
    show: {
      from: it.show.from > after ? it.show.from + 1 : it.show.from,
      to: it.show.to >= after ? it.show.to + 1 : it.show.to
    },
    states: it.states.map((s) => (s.frame > after ? { ...s, frame: s.frame + 1 } : s))
  }))
  return { ...b, frameCount: b.frameCount + 1, items }
}

/** Склеивает состояние кадра s со следующим n (n поверх s); результат — на кадре frame. */
function mergeStates(s: BoardState, n: BoardState | undefined, frame: number): BoardState {
  const out: BoardState = { frame }
  const geom = { ...s.geom, ...n?.geom }
  if (Object.keys(geom).length) out.geom = geom
  const pose = n?.pose ?? s.pose
  if (pose !== undefined) out.pose = pose
  const facing = n?.facing ?? s.facing
  if (facing !== undefined) out.facing = facing
  return out
}

export function removeFrame(b: Board, frame: number): Board {
  if (b.frameCount === 1) throw new Error('Нельзя удалить единственный кадр')
  checkFrame(b, frame)
  const shift = (s: BoardState): BoardState => ({ ...s, frame: s.frame - 1 })
  const items: BoardItem[] = []
  for (const it of b.items) {
    const { from, to } = it.show
    if (from === frame && to === frame) continue
    if (to < frame) {
      items.push(it)
    } else if (from > frame) {
      items.push({ ...it, show: { from: from - 1, to: to - 1 }, states: it.states.map(shift) })
    } else if (from === frame) {
      // Первый кадр элемента удалён: база = бывший следующий кадр.
      items.push({
        ...it,
        el: elementAt(it, frame + 1),
        show: { from, to: to - 1 },
        states: it.states.filter((s) => s.frame > frame + 1).map(shift)
      })
    } else {
      // from < frame <= to: состояние удаляемого кадра сливается в следующий.
      const own = it.states.find((s) => s.frame === frame)
      const next = it.states.find((s) => s.frame === frame + 1)
      const states: BoardState[] = []
      for (const s of it.states) {
        if (s.frame < frame) states.push(s)
        else if (s.frame === frame) {
          if (frame + 1 < b.frameCount) states.push(mergeStates(s, next, frame))
        } else if (s.frame === frame + 1 && own) continue
        else states.push(shift(s))
      }
      items.push({ ...it, show: { from, to: to - 1 }, states })
    }
  }
  return { ...b, frameCount: b.frameCount - 1, items }
}

export function setTransition(b: Board, sec: number): Board {
  if (!Number.isFinite(sec) || sec < MIN_TRANSITION || sec > MAX_TRANSITION)
    throw new Error('Переход вне допустимых пределов')
  return { ...b, transition: sec }
}

export function setView(b: Board, view: PitchViewId): Board {
  if (!PITCH_VIEW_IDS.includes(view)) throw new Error(`Нет вида ${view}`)
  return { ...b, view }
}

export function setTitle(b: Board, title: string): Board {
  if (title.length > MAX_TITLE) throw new Error('Название слишком длинное')
  return { ...b, title }
}
