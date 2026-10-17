// Настройки приложения: теги эпизодов и переопределённые горячие клавиши.
// Схема общая для main (проверка и запись файла) и интерфейса (редактирование). Версия `version` — для будущих миграций.
import { z } from 'zod'

export const SETTINGS_VERSION = 1
export const MAX_TAGS = 30
export const MAX_TAG_NAME = 40
export const MAX_TAG_SECONDS = 60
export const MAX_BINDINGS_PER_COMMAND = 4
export const MAX_KEYBINDING_COMMANDS = 200

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Сочетание клавиш: физическая клавиша (KeyboardEvent.code) и модификаторы. Ctrl означает и Cmd. */
export const BindingSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{1,24}$/),
  ctrl: z.boolean().default(false),
  alt: z.boolean().default(false),
  shift: z.boolean().default(false)
})

export const TagDefSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(MAX_TAG_NAME),
  color: z.string().regex(HEX_COLOR),
  preSeconds: z.number().min(0).max(MAX_TAG_SECONDS),
  postSeconds: z.number().min(0).max(MAX_TAG_SECONDS)
})

export const SettingsSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION),
    /** Только переопределения: id команды → список сочетаний. Пустой список — клавиша снята. */
    keybindings: z
      .record(z.string().min(1).max(64), z.array(BindingSchema).max(MAX_BINDINGS_PER_COMMAND))
      .refine((r) => Object.keys(r).length <= MAX_KEYBINDING_COMMANDS, 'Слишком много команд'),
    tags: z.array(TagDefSchema).max(MAX_TAGS)
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.tags.forEach((tag, index) => {
      if (seen.has(tag.id)) {
        ctx.addIssue({ code: 'custom', path: ['tags', index, 'id'], message: 'Повтор id тега' })
      }
      seen.add(tag.id)
    })
  })

export type Binding = z.infer<typeof BindingSchema>
export type TagDef = z.infer<typeof TagDefSchema>
export type Settings = z.infer<typeof SettingsSchema>

/** Результат загрузки настроек: warning — разовое неблокирующее сообщение (например, файл был повреждён). */
export interface SettingsLoadResult {
  settings: Settings
  warning: string | null
}

const tag = (id: string, name: string, color: string): TagDef => ({
  id,
  name,
  color,
  preSeconds: 5,
  postSeconds: 5
})

export const DEFAULT_TAGS: readonly TagDef[] = [
  tag('attack', 'Атака', '#2bd67b'),
  tag('defense', 'Оборона', '#4da3ff'),
  tag('transition-attack', 'Переход в атаку', '#b6e24a'),
  tag('transition-defense', 'Переход в оборону', '#8b6cff'),
  tag('set-piece', 'Стандарт', '#ffc83d'),
  tag('shot', 'Удар', '#ff8a3d'),
  tag('goal', 'Гол', '#ff4d6d'),
  tag('loss', 'Потеря', '#c0a3ff'),
  tag('tackle', 'Отбор', '#2ec4c4')
]

/** Клавиши тегов по умолчанию: Digit1…Digit9 в порядке стандартных тегов. */
export const DEFAULT_TAG_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  DEFAULT_TAGS.map((t, i) => [t.id, `Digit${i + 1}`])
)

export const tagCommandId = (tagId: string): string => `tag:${tagId}`

export function defaultSettings(): Settings {
  return { version: SETTINGS_VERSION, keybindings: {}, tags: DEFAULT_TAGS.map((t) => ({ ...t })) }
}

export type SettingsParse = { ok: true; settings: Settings } | { ok: false; error: string }

/**
 * Разбирает произвольные данные в настройки. Отсутствующие поля (старый файл) заполняются значениями по умолчанию,
 * всё остальное проверяется строго.
 */
export function parseSettings(raw: unknown): SettingsParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Настройки должны быть объектом' }
  }
  const input = raw as Record<string, unknown>
  const merged = {
    version: input.version ?? SETTINGS_VERSION,
    keybindings: input.keybindings ?? {},
    tags: input.tags ?? defaultSettings().tags
  }
  const result = SettingsSchema.safeParse(merged)
  if (result.success) return { ok: true, settings: result.data }
  const issue = result.error.issues[0]
  const where = issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
  return { ok: false, error: `${issue.message}${where}` }
}

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value)
}
