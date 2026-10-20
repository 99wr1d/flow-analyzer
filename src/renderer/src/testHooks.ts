// Тестовые функции для автотестов и замеров. Подключаются только если main включил флаги (см. src/main/testFlags.ts),
// то есть при запуске с FLOW_USER_DATA и FLOW_BENCH=1 / FLOW_TEST_CRASH=1. В обычной работе этого кода нет в window.
import type { AppInfo } from '../../shared/ipc-contract'
import { useCrashStore, type CrashAreaName } from './app/crashStore'
import { useAnnotationsStore } from './features/annotations/annotationsStore'
import { useEpisodesStore } from './features/episodes/episodesStore'
import { buildSaveRequest } from './features/project/snapshot'
import { useProjectStore } from './features/project/projectStore'

export interface FlowTestHooks {
  /** Нарочно ломает отрисовку выбранной области (проверка экрана «Что-то пошло не так»). */
  crash?: (area: CrashAreaName) => void
  /** Замер: собрать снимок для сохранения. Возвращает миллисекунды и размер JSON. */
  snapshot?: () => { ms: number; bytes: number; episodes: number; annotations: number }
  /** Замер: собрать снимок и отправить автосохранение; миллисекунды всего круга. */
  autosave?: () => Promise<{ buildMs: number; totalMs: number }>
}

declare global {
  interface Window {
    __flowTest?: FlowTestHooks
  }
}

export function installTestHooks(flags: AppInfo['testFlags']): void {
  const hooks: FlowTestHooks = {}
  if (flags.crash) {
    hooks.crash = (area) => useCrashStore.getState().arm(area)
  }
  if (flags.bench) {
    hooks.snapshot = () => {
      const t0 = performance.now()
      const request = buildSaveRequest(useProjectStore.getState().path)
      const ms = performance.now() - t0
      return {
        ms,
        bytes: request ? JSON.stringify(request).length : 0,
        episodes: useEpisodesStore.getState().items.length,
        annotations: useAnnotationsStore.getState().items.length
      }
    }
    hooks.autosave = async () => {
      const t0 = performance.now()
      const request = buildSaveRequest(useProjectStore.getState().path)
      const buildMs = performance.now() - t0
      if (!request) throw new Error('нет видео')
      await window.api.autosaveProject(request)
      return { buildMs, totalMs: performance.now() - t0 }
    }
  }
  if (Object.keys(hooks).length > 0) window.__flowTest = hooks
}
