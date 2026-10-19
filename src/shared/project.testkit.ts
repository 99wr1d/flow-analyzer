// Примеры данных для тестов проекта (в приложение не попадает).
import type { Annotation } from './annotations'
import type { Episode } from './episodes'
import { PROJECT_FORMAT, PROJECT_VERSION, type Project } from './project'

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const sampleAnnotation = (n = 1): Annotation => ({
  id: uuid(n),
  space: 'screen',
  type: 'arrow',
  p1: { x: 0.1, y: 0.2 },
  p2: { x: 0.6, y: 0.4 },
  style: { color: '#ffffff', width: 0.011, dash: 'solid' },
  timing: { mode: 'range', start: 1, duration: 3 }
})

export const sampleEpisode = (n = 1): Episode => ({
  id: uuid(1000 + n),
  tagId: 'goal',
  tagName: 'Гол',
  tagColor: '#ff4d6d',
  start: 2,
  end: 7.5,
  note: 'Хороший момент',
  rating: null,
  review: false
})

export function sampleProject(videoPath = '/video/match.mp4'): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-02T10:00:00.000Z',
    appVersion: '0.6.0',
    video: {
      path: videoPath,
      relativePath: '../video/match.mp4',
      fileName: 'match.mp4',
      sizeBytes: 12345,
      fps: 25,
      fpsSource: 'container'
    },
    annotations: [sampleAnnotation(1)],
    calibrations: [],
    episodes: [sampleEpisode(1)],
    tags: [{ id: 'goal', name: 'Гол', color: '#ff4d6d', preSeconds: 5, postSeconds: 5 }],
    ui: { lastTime: 4.5 }
  }
}
