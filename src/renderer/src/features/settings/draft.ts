// Черновик настроек в диалоге: поля тегов хранятся как текст (пока человек печатает), проверяются и собираются при сохранении.
import {
  MAX_TAGS,
  MAX_TAG_NAME,
  MAX_TAG_SECONDS,
  SETTINGS_VERSION,
  isHexColor,
  type Settings,
  type TagDef
} from '../../../../shared/settings'
import { allCommands } from '../commands/definitions'
import { compactOverrides, type Overrides } from '../commands/keymap'

export interface TagDraft {
  id: string
  name: string
  color: string
  pre: string
  post: string
}

export interface TagErrors {
  name?: string
  color?: string
  pre?: string
  post?: string
}

/** Цвета-образцы для тегов (первые девять — как у стандартных тегов). */
export const TAG_SWATCHES = [
  '#2bd67b',
  '#4da3ff',
  '#b6e24a',
  '#8b6cff',
  '#ffc83d',
  '#ff8a3d',
  '#ff4d6d',
  '#c0a3ff',
  '#2ec4c4',
  '#e056fd',
  '#9aa3b2',
  '#ffffff'
] as const

const fmtSeconds = (n: number): string => String(Math.round(n * 100) / 100)

export function tagToDraft(tag: TagDef): TagDraft {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    pre: fmtSeconds(tag.preSeconds),
    post: fmtSeconds(tag.postSeconds)
  }
}

/** Секунды из текста («5», «2,5»). null — не число или вне 0…60. */
export function parseSeconds(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const value = Number(t)
  return Number.isFinite(value) && value >= 0 && value <= MAX_TAG_SECONDS ? value : null
}

export function validateTagDraft(d: TagDraft): TagErrors {
  const errors: TagErrors = {}
  const name = d.name.trim()
  if (name.length === 0 || name.length > MAX_TAG_NAME) errors.name = 'name'
  if (!isHexColor(d.color.trim())) errors.color = 'color'
  if (parseSeconds(d.pre) === null) errors.pre = 'pre'
  if (parseSeconds(d.post) === null) errors.post = 'post'
  return errors
}

export const hasErrors = (errors: TagErrors): boolean => Object.keys(errors).length > 0

export function newTagId(): string {
  return `t-${crypto.randomUUID().slice(0, 8)}`
}

/** Новый тег: цвет — первый образец, которого ещё нет у других тегов. */
export function newTagDraft(existing: readonly TagDraft[], name: string): TagDraft {
  const used = new Set(existing.map((t) => t.color.toLowerCase()))
  const color = TAG_SWATCHES.find((c) => !used.has(c)) ?? TAG_SWATCHES[0]
  return { id: newTagId(), name, color, pre: '5', post: '5' }
}

export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export const canAddTag = (count: number): boolean => count < MAX_TAGS

export type BuildResult = { ok: true; settings: Settings } | { ok: false }

/** Собирает настройки из черновика. Ошибки в полях тегов — отказ (поля уже подсвечены). */
export function buildSettings(drafts: readonly TagDraft[], overrides: Overrides): BuildResult {
  const tags: TagDef[] = []
  for (const d of drafts) {
    if (hasErrors(validateTagDraft(d))) return { ok: false }
    tags.push({
      id: d.id,
      name: d.name.trim(),
      color: d.color.trim().toLowerCase(),
      preSeconds: parseSeconds(d.pre) as number,
      postSeconds: parseSeconds(d.post) as number
    })
  }
  const keybindings = compactOverrides(allCommands(tags), overrides)
  return {
    ok: true,
    settings: {
      version: SETTINGS_VERSION,
      keybindings: Object.fromEntries(
        Object.entries(keybindings).map(([id, list]) => [id, [...list]])
      ),
      tags
    }
  }
}
