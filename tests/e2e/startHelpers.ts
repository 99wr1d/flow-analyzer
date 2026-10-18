// Общие помощники для тестов стартового экрана и оценок: проекты-файлы, создание проекта через окно, эпизоды.
import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fixture, seekVideo, stubDialog } from './helpers'

export type Ctx = {
  app: ElectronApplication
  win: Page
  userData: string
  projectsDir: string
}

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export interface SeedEpisode {
  n: number
  tagId?: string
  tagName?: string
  tagColor?: string
  start: number
  end: number
  rating?: 'good' | 'bad' | null
  review?: boolean
  /** true — поля rating/review в файл не пишутся (как в проектах прежних версий). */
  legacy?: boolean
}

export interface SeedOptions {
  video?: string
  meta?: {
    title: string
    type: 'match' | 'training' | 'scouting' | 'other'
    date?: string
    notes?: string
  }
  episodes?: SeedEpisode[]
  annotations?: number
  updatedAt?: string
  duration?: number
}

/** Содержимое корректного файла проекта (формат версии 1). */
export function projectJson(options: SeedOptions = {}): string {
  const video = options.video ?? fixture('cfr25.mp4')
  const episodes = (options.episodes ?? []).map((e) => ({
    id: uuid(1000 + e.n),
    tagId: e.tagId ?? 'attack',
    tagName: e.tagName ?? 'Атака',
    tagColor: e.tagColor ?? '#2bd67b',
    start: e.start,
    end: e.end,
    ...(e.legacy ? {} : { rating: e.rating ?? null, review: e.review ?? false })
  }))
  const annotations = Array.from({ length: options.annotations ?? 0 }, (_, i) => ({
    id: uuid(2000 + i),
    type: 'arrow',
    p1: { x: 0.1, y: 0.2 },
    p2: { x: 0.6, y: 0.4 },
    style: { color: '#ffffff', width: 0.011, dash: 'solid' },
    timing: { mode: 'range', start: 1, duration: 2 }
  }))
  const name = video.split(/[\\/]/).pop() as string
  return JSON.stringify(
    {
      format: 'flowanalyzer-project',
      version: 1,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: options.updatedAt ?? '2026-02-01T10:00:00.000Z',
      appVersion: '0.10.0',
      video: {
        path: video,
        relativePath: null,
        fileName: name,
        sizeBytes: 1,
        ...(options.duration ? { duration: options.duration } : {})
      },
      annotations,
      episodes,
      tags: [],
      ui: { lastTime: 1 },
      ...(options.meta ? { meta: options.meta } : {})
    },
    null,
    2
  )
}

export function seedProject(path: string, options: SeedOptions = {}): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, projectJson(options), 'utf8')
  return path
}

/** library.json с заданными путями (как будто проекты уже открывали раньше). */
export function seedLibrary(userData: string, paths: string[]): void {
  mkdirSync(userData, { recursive: true })
  const items = paths.map((path, i) => ({
    path,
    addedAt: `2026-02-0${i + 1}T10:00:00.000Z`,
    lastOpenedAt: `2026-02-0${i + 1}T11:00:00.000Z`
  }))
  writeFileSync(join(userData, 'library.json'), JSON.stringify({ version: 1, items }), 'utf8')
}

export interface NewProjectOptions {
  title: string
  type?: 'match' | 'training' | 'scouting' | 'other'
  notes?: string
  date?: string
  video?: string
}

const TYPE_ID = { match: 'match', training: 'training', scouting: 'scouting', other: 'other' }

/** Создаёт проект через окно «Новый проект» (видео выбирается подменённым системным диалогом). */
export async function createProject(
  ctx: Pick<Ctx, 'app' | 'win'>,
  o: NewProjectOptions
): Promise<void> {
  const { app, win } = ctx
  await stubDialog(app, o.video ?? fixture('cfr25.mp4'))
  await win.keyboard.press('Control+n')
  await expect(win.getByTestId('new-project-dialog')).toBeVisible()
  await win.getByTestId('np-title').fill(o.title)
  if (o.type) await win.getByTestId(`np-type-${TYPE_ID[o.type]}`).click()
  if (o.date) await win.getByTestId('np-date').fill(o.date)
  if (o.notes) await win.getByTestId('np-notes').fill(o.notes)
  await win.getByTestId('np-video').click()
  await expect(win.getByTestId('np-video-name')).not.toHaveText('Видео не выбрано')
  await win.getByTestId('np-create').click()
  await expect(win.getByTestId('new-project-dialog')).toHaveCount(0)
  await expect(win.getByTestId('project-name')).toHaveText(o.title)
  await expect(win.getByTestId('play-toggle')).toBeEnabled()
  await expect(win.getByTestId('annotation-layer')).toBeVisible()
}

/** Быстрый просмотр видео без проекта (кнопка «Просто открыть видео» на стартовом экране). */
export async function quickOpen(
  ctx: Pick<Ctx, 'app' | 'win'>,
  video = fixture('cfr25.mp4')
): Promise<void> {
  await stubDialog(ctx.app, video)
  await ctx.win.getByTestId('open-video').click()
  await expect(ctx.win.getByTestId('play-toggle')).toBeEnabled()
  await expect(ctx.win.getByTestId('annotation-layer')).toBeVisible()
}

/** Эпизод тегом с клавиатуры: перемотка, затем Digit1…Digit9 (быстрый тег ±5 с). */
export async function tagAt(win: Page, time: number, digit = 1): Promise<void> {
  await seekVideo(win, time)
  await win.keyboard.press(`Digit${digit}`)
}

/** Эпизод ровно между start и end (метки I и O, затем тег). */
export async function addEpisode(win: Page, start: number, end: number, digit = 1): Promise<void> {
  await seekVideo(win, start)
  await win.keyboard.press('i')
  await seekVideo(win, end)
  await win.keyboard.press('o')
  await win.keyboard.press(`Digit${digit}`)
}

export const cards = (win: Page) => win.getByTestId('project-card')
export const cardByTitle = (win: Page, title: string) =>
  win.locator('[data-testid="project-card"]').filter({ hasText: title })
