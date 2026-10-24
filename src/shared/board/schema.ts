/** Файл доски тренера (.flowboard): схема, разбор, запись. */
import { z } from 'zod'
import {
  ArrowSchema,
  CircleSchema,
  CurveSchema,
  LineSchema,
  PenSchema,
  TextSchema,
  ZoneSchema
} from '../annotations'
import { GEOM_FIELDS } from '../animation'
import { EQUIPMENT_IDS, FACINGS, FIGURE_POSES, FIGURE_SETS, PITCH_VIEW_IDS } from './ids'

export const BOARD_FORMAT = 'flowanalyzer-board'
/**
 * Версию нужно поднимать, когда меняются id (позы, виды, инвентарь), виды элементов
 * или встроенные схемы рисунков: старые программы не должны открывать такие файлы как свои.
 * Формат закреплён тестом на файле tests/fixtures/board-v1.flowboard.
 */
export const BOARD_VERSION = 1
export const BOARD_EXTENSION = 'flowboard'

export const MAX_FRAMES = 50
export const MAX_ITEMS = 500
export const MIN_TRANSITION = 0.3
export const MAX_TRANSITION = 5
export const DEFAULT_TRANSITION = 1
export const MAX_TITLE = 120
export const MAX_TOKEN_LABEL = 2
/** Предел размера миниатюры доски (символов data-URL). */
export const MAX_THUMB = 80_000

const unit = z.number().min(0).max(1)
const PointSchema = z.object({ x: unit, y: unit })
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const facing = z.enum(FACINGS)
const scale = z.number().min(0.2).max(4)
const rotation = z.number().min(-180).max(180)

const FigureSchema = z
  .object({
    kind: z.literal('figure'),
    set: z.enum(FIGURE_SETS),
    pose: z.string(),
    facing,
    /** Точка между ступнями. */
    pos: PointSchema,
    scale,
    rotation,
    color
  })
  .superRefine((f, ctx) => {
    if (!FIGURE_POSES[f.set].includes(f.pose))
      ctx.addIssue({
        code: 'custom',
        path: ['pose'],
        message: `Поза ${f.pose} недоступна для набора ${f.set}`
      })
  })

const EquipSchema = z.object({
  kind: z.literal('equip'),
  item: z.enum(EQUIPMENT_IDS),
  pos: PointSchema,
  scale,
  rotation,
  color
})

/** Кружок с короткой подписью. */
const TokenSchema = z.object({
  kind: z.literal('token'),
  pos: PointSchema,
  scale,
  color,
  label: z.string().max(MAX_TOKEN_LABEL)
})

const NumberSchema = z.object({
  kind: z.literal('number'),
  pos: PointSchema,
  scale,
  color,
  n: z.number().int().min(1).max(99)
})

/** Волнистая стрелка «змейка». */
const WavySchema = z.object({
  kind: z.literal('wavy'),
  p1: PointSchema,
  p2: PointSchema,
  color,
  width: z.number().min(0.001).max(0.05)
})

/** Заштрихованная зона. */
const HatchSchema = z.object({
  kind: z.literal('hatch'),
  shape: z.enum(['rect', 'tri', 'ellipse']),
  p1: PointSchema,
  p2: PointSchema,
  color
})

/** Экранный рисунок без времени и ключей: по кадрам доски он меняется через states. Лишние поля (timing) — ошибка. */
const bare = { timing: true, keyframes: true } as const
const BoardAnnSchema = z.discriminatedUnion('type', [
  ArrowSchema.omit(bare).strict(),
  LineSchema.omit(bare).strict(),
  CircleSchema.omit(bare).strict(),
  TextSchema.omit(bare).strict(),
  CurveSchema.omit(bare).strict(),
  PenSchema.omit(bare).strict(),
  ZoneSchema.omit(bare).strict()
])

const ShapeSchema = z.object({ kind: z.literal('shape'), ann: BoardAnnSchema })

export const BoardElementSchema = z.discriminatedUnion('kind', [
  FigureSchema,
  EquipSchema,
  TokenSchema,
  NumberSchema,
  WavySchema,
  HatchSchema,
  ShapeSchema
])

export const BoardStateSchema = z.object({
  frame: z.number().int().min(1),
  geom: z.record(z.string(), z.unknown()).optional(),
  pose: z.string().optional(),
  facing: facing.optional()
})

export const BoardItemSchema = z
  .object({
    id: z.uuid(),
    show: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }),
    el: BoardElementSchema,
    states: z.array(BoardStateSchema).max(MAX_FRAMES)
  })
  .superRefine((it, ctx) => {
    if (it.show.to < it.show.from)
      ctx.addIssue({ code: 'custom', path: ['show', 'to'], message: 'show.to меньше show.from' })
    let prev = it.show.from
    it.states.forEach((s, i) => {
      if (s.frame <= prev)
        ctx.addIssue({
          code: 'custom',
          path: ['states', i, 'frame'],
          message: 'Кадры состояний должны строго расти и быть позже show.from'
        })
      prev = s.frame
    })
  })

export const BoardSchema = z
  .object({
    format: z.literal(BOARD_FORMAT),
    version: z.number().int().min(1),
    title: z.string().max(MAX_TITLE),
    view: z.enum(PITCH_VIEW_IDS),
    frameCount: z.number().int().min(1).max(MAX_FRAMES),
    transition: z.number().min(MIN_TRANSITION).max(MAX_TRANSITION),
    items: z.array(BoardItemSchema).max(MAX_ITEMS),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    thumb: z.string().max(MAX_THUMB).startsWith('data:image/jpeg;base64,').optional()
  })
  .superRefine((b, ctx) => {
    b.items.forEach((it, i) => {
      if (it.show.to >= b.frameCount)
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'show', 'to'],
          message: 'show.to за пределами кадров'
        })
      it.states.forEach((s, j) => {
        if (s.frame >= b.frameCount)
          ctx.addIssue({
            code: 'custom',
            path: ['items', i, 'states', j, 'frame'],
            message: 'Кадр состояния за пределами кадров'
          })
      })
    })
  })

export type Board = z.infer<typeof BoardSchema>
export type BoardItem = z.infer<typeof BoardItemSchema>
export type BoardElement = z.infer<typeof BoardElementSchema>
export type BoardState = z.infer<typeof BoardStateSchema>

export function newBoard(title: string, now: Date): Board {
  const iso = now.toISOString()
  return {
    format: BOARD_FORMAT,
    version: BOARD_VERSION,
    title,
    view: 'box-front',
    frameCount: 1,
    transition: DEFAULT_TRANSITION,
    items: [],
    createdAt: iso,
    updatedAt: iso
  }
}

export function boardToFile(board: Board): string {
  return JSON.stringify(board, null, 2)
}

/** Геометрические поля, меняемые по кадрам. Для shape — ключи внутри ann: см. shapeGeomKeys (здесь объединение по всем семи типам). */
export const GEOM_KEYS: Record<BoardElement['kind'], readonly string[]> = {
  figure: ['pos', 'scale', 'rotation'],
  equip: ['pos', 'scale', 'rotation'],
  token: ['pos', 'scale'],
  number: ['pos', 'scale'],
  wavy: ['p1', 'p2'],
  hatch: ['p1', 'p2'],
  shape: Array.from(
    new Set(
      (['arrow', 'line', 'circle', 'text', 'curve', 'pen', 'zone'] as const).flatMap(
        (t) => GEOM_FIELDS[t]
      )
    )
  )
}

/** Геометрические ключи конкретного рисунка shape (внутри ann). */
export const shapeGeomKeys = (type: z.infer<typeof BoardAnnSchema>['type']): readonly string[] =>
  GEOM_FIELDS[type]
