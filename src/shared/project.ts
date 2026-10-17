// Формат файла проекта (.flowproj) и данные, которыми обмениваются main и интерфейс при сохранении/открытии.
// Файл — обычный UTF-8 JSON. Разбор строгий: всё, что не проходит схему, отклоняется с понятной ошибкой.
import { z } from 'zod'
import { AnnotationListSchema } from './annotations'
import { EpisodeListSchema } from './episodes'
import type { VideoSource } from './ipc-contract'
import { TagDefSchema } from './settings'

export const PROJECT_FORMAT = 'flowanalyzer-project'
export const PROJECT_VERSION = 1
export const PROJECT_EXTENSION = 'flowproj'
export const UNTITLED_PROJECT = 'Новый проект'

/** Файл больше этого размера не читается вообще (проверка до разбора). */
export const MAX_PROJECT_BYTES = 20 * 1024 * 1024
export const MAX_ANNOTATIONS = 10_000
export const MAX_EPISODES = 10_000
export const MAX_PROJECT_TAGS = 100
export const MAX_PROJECT_PATH = 1024
export const MAX_RECENT = 10

export const FPS_SOURCES = ['container', 'estimated', 'default'] as const

const path = z
  .string()
  .min(1)
  .max(MAX_PROJECT_PATH)
  .refine((p) => !p.includes('\0'), 'Плохой путь')

const VideoRefSchema = z.object({
  /** Абсолютный путь к видео на момент сохранения. */
  path,
  /** Путь относительно папки проекта: нужен, чтобы проект с видео можно было перенести вместе. */
  relativePath: path.nullable(),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(0),
  fps: z.number().gt(0).max(1000).optional(),
  fpsSource: z.enum(FPS_SOURCES).optional()
})

const UiSchema = z.object({ lastTime: z.number().min(0).max(1e7) })

const timestamp = z.iso.datetime()

export const ProjectSchema = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    version: z.literal(PROJECT_VERSION),
    createdAt: timestamp,
    updatedAt: timestamp,
    appVersion: z.string().max(40),
    video: VideoRefSchema,
    annotations: AnnotationListSchema.max(MAX_ANNOTATIONS),
    episodes: EpisodeListSchema.max(MAX_EPISODES),
    /** Теги, известные на момент сохранения (настройки + теги, использованные в эпизодах). */
    tags: z.array(TagDefSchema).max(MAX_PROJECT_TAGS),
    ui: UiSchema.optional()
  })
  .superRefine((p, ctx) => {
    const unique = (key: 'annotations' | 'episodes' | 'tags'): void => {
      const seen = new Set<string>()
      p[key].forEach((item, index) => {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [key, index, 'id'],
            message: 'Повтор идентификатора'
          })
        }
        seen.add(item.id)
      })
    }
    unique('annotations')
    unique('episodes')
    unique('tags')
  })

export type Project = z.infer<typeof ProjectSchema>
export type ProjectVideoRef = Project['video']

/** Что интерфейс присылает для сохранения. Путь к видео интерфейс не знает: main берёт его из реестра по videoId. */
export const ProjectSaveRequestSchema = z.object({
  videoId: z.uuid(),
  annotations: AnnotationListSchema.max(MAX_ANNOTATIONS),
  episodes: EpisodeListSchema.max(MAX_EPISODES),
  tags: z.array(TagDefSchema).max(MAX_PROJECT_TAGS),
  lastTime: z.number().min(0).max(1e7),
  fps: z.number().gt(0).max(1000).optional(),
  fpsSource: z.enum(FPS_SOURCES).optional(),
  /** Файл, в который проект уже сохранялся (null — ещё нет). */
  currentPath: path.nullable()
})
export type ProjectSaveRequest = z.infer<typeof ProjectSaveRequestSchema>

export type ProjectSaveResult =
  | { status: 'saved'; path: string; name: string; savedAt: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; details?: string }

/** Проект, готовый к загрузке в интерфейс. */
export interface LoadedProject {
  path: string | null
  name: string
  source: VideoSource
  annotations: Project['annotations']
  episodes: Project['episodes']
  tags: Project['tags']
  lastTime: number
  fps?: number
  fpsSource?: (typeof FPS_SOURCES)[number]
  /** Есть несохранённые изменения (восстановление из автосохранения, перепривязка видео). */
  dirty: boolean
  /** Неблокирующее предупреждение (например, размер видео отличается от сохранённого). */
  warning: string | null
}

export type ProjectOpenResult =
  | { status: 'opened'; project: LoadedProject }
  | { status: 'cancelled' }
  /** Видео не нашлось. По билету ticket можно указать файл вручную. */
  | { status: 'video-missing'; ticket: string; name: string; videoFileName: string }
  | { status: 'error'; message: string; details?: string }

export interface RecentProject {
  path: string
  name: string
  openedAt: string
}

export interface RecoveryItem {
  key: string
  name: string
  projectPath: string | null
  videoFileName: string
  savedAt: string
}

export type ProjectParse =
  { ok: true; project: Project } | { ok: false; message: string; details?: string }

const asObject = (raw: unknown): Record<string, unknown> | null =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null

/**
 * Приводит сырые данные файла к текущей версии формата. Сейчас версия одна, поэтому данные возвращаются как есть;
 * новые версии добавят здесь шаги `1 → 2` и т. д.
 */
export function migrateProject(
  raw: unknown
): { ok: true; data: unknown } | { ok: false; message: string } {
  const obj = asObject(raw)
  if (!obj || obj.format !== PROJECT_FORMAT) {
    return { ok: false, message: 'Это не файл проекта FlowAnalyzer' }
  }
  const version = obj.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: 'Не удалось определить версию файла проекта' }
  }
  if (version > PROJECT_VERSION) {
    return { ok: false, message: 'Файл создан более новой версией FlowAnalyzer' }
  }
  return { ok: true, data: obj }
}

/** Разбор текста файла проекта: размер, JSON, версия, схема. Не бросает исключений. */
export function parseProjectText(text: string): ProjectParse {
  if (text.length > MAX_PROJECT_BYTES) {
    return {
      ok: false,
      message: 'Файл проекта слишком большой',
      details: `Больше ${MAX_PROJECT_BYTES} байт`
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    return {
      ok: false,
      message: 'Файл проекта повреждён: это не JSON',
      details: error instanceof Error ? error.message : undefined
    }
  }
  const migrated = migrateProject(raw)
  if (!migrated.ok) return { ok: false, message: migrated.message }
  const result = ProjectSchema.safeParse(migrated.data)
  if (result.success) return { ok: true, project: result.data }
  const issues = result.error.issues.slice(0, 5).map((i) => {
    const where = i.path.length > 0 ? `${i.path.join('.')}: ` : ''
    return `${where}${i.message}`
  })
  return {
    ok: false,
    message: 'Файл проекта повреждён или содержит неверные данные',
    details: issues.join('\n')
  }
}

/** Имя проекта по имени файла: без папки и без расширения. */
export function projectNameFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  const dot = base.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)
    ? base.length - (PROJECT_EXTENSION.length + 1)
    : base.length
  return base.slice(0, dot) || UNTITLED_PROJECT
}
