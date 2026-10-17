import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { locateVideo, toRelativePath } from './paths'

const root = resolve('/flow-test')
const projectPath = join(root, 'projects', 'game.flowproj')

describe('относительный путь к видео', () => {
  it('рядом с проектом и в соседней папке', () => {
    expect(toRelativePath(projectPath, join(root, 'projects', 'v.mp4'))).toBe('v.mp4')
    expect(toRelativePath(projectPath, join(root, 'video', 'v.mp4'))).toBe('../video/v.mp4')
  })
})

describe('поиск видео', () => {
  const video = { path: join(root, 'old', 'v.mp4'), relativePath: 'v.mp4' }
  const existing = (...paths: string[]) => {
    const set = new Set(paths.map((p) => resolve(p)))
    return (p: string): Promise<boolean> => Promise.resolve(set.has(resolve(p)))
  }

  it('сначала сохранённый абсолютный путь', async () => {
    const found = await locateVideo(
      projectPath,
      video,
      existing(video.path, join(root, 'projects', 'v.mp4'))
    )
    expect(found).toEqual({ path: video.path, via: 'absolute' })
  })

  it('иначе — относительный путь от папки проекта', async () => {
    const found = await locateVideo(projectPath, video, existing(join(root, 'projects', 'v.mp4')))
    expect(found?.via).toBe('relative')
    expect(resolve(found!.path)).toBe(resolve(join(root, 'projects', 'v.mp4')))
  })

  it('нигде нет — null', async () => {
    expect(await locateVideo(projectPath, video, existing())).toBeNull()
  })

  it('относительный путь не используется без пути проекта или без relativePath', async () => {
    const exists = existing(join(root, 'projects', 'v.mp4'))
    expect(await locateVideo(null, video, exists)).toBeNull()
    expect(await locateVideo(projectPath, { ...video, relativePath: null }, exists)).toBeNull()
  })
})
