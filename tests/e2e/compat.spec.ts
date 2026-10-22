// Совместимость: проекты всех прошлых версий (tests/fixtures/projects) открываются в приложении без ошибок,
// данные на месте, после сохранения получается файл текущего формата, который открывается снова.
import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { APP_VERSION, fixture, launch, makeUserData } from './helpers'

interface Raw {
  appVersion: string
  video: { path: string; relativePath: string | null; sizeBytes: number }
  annotations: Array<{ id: string }>
  calibrations?: unknown[]
  episodes: Array<{ id: string; rating?: unknown; review?: unknown }>
}

const DIR = resolve('tests/fixtures/projects')
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.flowproj'))
  .sort()

test('на каждую эпоху формата есть файл', () => {
  expect(files).toEqual([
    'v0.10.0.flowproj',
    'v0.11.0.flowproj',
    'v0.13.0.flowproj',
    'v0.14.0.flowproj',
    'v0.17.0.flowproj',
    'v0.6.0.flowproj',
    'v0.9.0.flowproj'
  ])
})

for (const file of files) {
  test(`проект версии ${file.replace('.flowproj', '')}: открывается, сохраняется в текущем формате и открывается снова`, async () => {
    const userData = makeUserData()
    const dir = join(userData, 'Projects')
    mkdirSync(dir, { recursive: true })
    const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Raw
    const original = {
      episodes: raw.episodes.map((e) => e.id),
      annotations: raw.annotations.map((a) => a.id)
    }
    raw.video.path = fixture('cfr25.mp4')
    raw.video.relativePath = null
    raw.video.sizeBytes = statSync(fixture('cfr25.mp4')).size
    const project = join(dir, `era-${file}`)
    writeFileSync(project, JSON.stringify(raw, null, 2), 'utf8')

    const first = await launch({ userData, args: [project] })
    try {
      const { win } = first
      await expect(win.getByTestId('play-toggle')).toBeEnabled({ timeout: 30_000 })
      await expect(win.getByTestId('episode-count')).toHaveText(String(original.episodes.length))
      await expect(win.getByTestId('track-item')).toHaveCount(original.annotations.length)
      // Никаких сообщений об ошибке, предупреждений и сломанных панелей.
      await expect(win.getByTestId('project-error')).toHaveCount(0)
      await expect(win.getByTestId('project-warning')).toHaveCount(0)
      await expect(win.getByTestId('error-boundary')).toHaveCount(0)
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)

      // Правка и сохранение (Ctrl+S): проект уже с путём, диалога нет.
      await win.keyboard.press('Digit1')
      await expect(win.getByTestId('episode-count')).toHaveText(
        String(original.episodes.length + 1)
      )
      await win.keyboard.press('Control+KeyS')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
    } finally {
      await first.app.close()
    }

    const saved = JSON.parse(readFileSync(project, 'utf8')) as Raw
    expect(saved.appVersion).toBe(APP_VERSION)
    expect(Array.isArray(saved.calibrations)).toBe(true)
    expect(saved.episodes).toHaveLength(original.episodes.length + 1)
    for (const id of original.episodes) expect(saved.episodes.some((e) => e.id === id)).toBe(true)
    for (const id of original.annotations)
      expect(saved.annotations.some((a) => a.id === id)).toBe(true)
    // Поля текущего формата заполнены у всех эпизодов (в старых файлах их не было).
    for (const e of saved.episodes) expect('rating' in e && 'review' in e).toBe(true)

    // Заново: сохранённый файл открывается, данные те же.
    const second = await launch({ userData, args: [project] })
    try {
      const { win } = second
      await expect(win.getByTestId('play-toggle')).toBeEnabled({ timeout: 30_000 })
      await expect(win.getByTestId('episode-count')).toHaveText(
        String(original.episodes.length + 1)
      )
      await expect(win.getByTestId('track-item')).toHaveCount(original.annotations.length)
      await expect(win.getByTestId('project-error')).toHaveCount(0)
      await expect(win.getByTestId('error-boundary')).toHaveCount(0)
    } finally {
      await second.app.close()
    }
  })
}
