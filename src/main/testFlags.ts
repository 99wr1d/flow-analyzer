// Тестовые возможности приложения. Работают ТОЛЬКО когда задана отдельная папка данных FLOW_USER_DATA
// (так запускаются автотесты и замеры): у обычного пользователя эта переменная не задана, и все флаги выключены.
//   FLOW_TEST_CRASH=1 — интерфейс получает функцию, которая нарочно ломает отрисовку (проверка экрана ошибки).
//   FLOW_BENCH=1      — интерфейс получает функции замера (сборка снимка проекта, автосохранение).
//   FLOW_TEST_GPU_FAIL=1 — экспорт «видит» видеокарту, кодер которой ломается: проверка отката на процессор.
//   FLOW_EXPORT_CHUNK_SEC=N — экспорт всегда идёт параллельными кусками по N секунд (проверка склейки на коротких видео).
//   FLOW_NO_TIPS=1    — подсказки первого запуска не показываются сами (иначе они мешали бы остальным автотестам).
import { isAbsolute } from 'path'

export interface TestFlags {
  crash: boolean
  bench: boolean
  noTips: boolean
  gpuFail: boolean
  /** Длина куска параллельного экспорта в секундах; null — как обычно. */
  exportChunkSeconds: number | null
}

function parseChunkSeconds(raw: string | undefined): number | null {
  const value = Number(raw)
  return raw !== undefined && Number.isFinite(value) && value >= 0.5 && value <= 600 ? value : null
}

export function parseTestFlags(env: NodeJS.ProcessEnv): TestFlags {
  const isolated = typeof env['FLOW_USER_DATA'] === 'string' && isAbsolute(env['FLOW_USER_DATA'])
  return {
    crash: isolated && env['FLOW_TEST_CRASH'] === '1',
    bench: isolated && env['FLOW_BENCH'] === '1',
    noTips: isolated && env['FLOW_NO_TIPS'] === '1',
    gpuFail: isolated && env['FLOW_TEST_GPU_FAIL'] === '1',
    exportChunkSeconds: isolated ? parseChunkSeconds(env['FLOW_EXPORT_CHUNK_SEC']) : null
  }
}

export const testFlags = (): TestFlags => parseTestFlags(process.env)
