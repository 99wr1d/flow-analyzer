// Тестовые возможности приложения. Работают ТОЛЬКО когда задана отдельная папка данных FLOW_USER_DATA
// (так запускаются автотесты и замеры): у обычного пользователя эта переменная не задана, и все флаги выключены.
//   FLOW_TEST_CRASH=1 — интерфейс получает функцию, которая нарочно ломает отрисовку (проверка экрана ошибки).
//   FLOW_BENCH=1      — интерфейс получает функции замера (сборка снимка проекта, автосохранение).
//   FLOW_TEST_GPU_FAIL=1 — экспорт «видит» видеокарту, кодер которой ломается: проверка отката на процессор.
//   FLOW_EXPORT_CHUNK_SEC=N — экспорт всегда идёт параллельными кусками по N секунд (проверка склейки на коротких видео).
//   FLOW_DETECTOR_BACKEND=wasm — окно-детектор слежения работает на процессоре (WASM), даже если есть видеокарта.
//   FLOW_TEST_DETECTOR=1 — в главном процессе доступна globalThis.__flowCreateDetector (автотест окна-детектора).
//   FLOW_DETECTOR_STUB=1 — слежение использует детектор-заглушку (src/main/tracking/stubDetector.ts) вместо модели; сценарий рамок —
//                      файл FLOW_DETECTOR_STUB_PATTERN=<абсолютный путь .json> (иначе стандартный), пауза на запрос — FLOW_DETECTOR_STUB_DELAY_MS.
//   FLOW_DETECTOR_LOAD_DELAY_MS=N — окно-детектор запускает страницу через N мс (имитация долгой загрузки модели: проверка отмены при запуске).
//   FLOW_DETECTOR_DEBUG=1 — сообщения страницы окна-детектора дублируются в stderr.
//   FLOW_NO_TIPS=1    — подсказки первого запуска не показываются сами (иначе они мешали бы остальным автотестам).
import { isAbsolute } from 'path'

export interface TestFlags {
  crash: boolean
  bench: boolean
  noTips: boolean
  gpuFail: boolean
  /** Автотест окна-детектора может создать детектор из главного процесса. */
  detectorProbe: boolean
  detectorDebug: boolean
  /** Задержка запуска страницы окна-детектора, мс (только для тестов отмены). */
  detectorLoadDelayMs: number
  /** Слежение работает на детекторе-заглушке (без модели). */
  detectorStub: boolean
  /** Файл сценария заглушки (абсолютный путь) или null — стандартный сценарий. */
  detectorStubPattern: string | null
  /** Пауза заглушки на каждый запрос, мс. */
  detectorStubDelayMs: number
  /** 'wasm' — окно-детектор не использует WebGPU; null — как обычно. */
  detectorBackend: 'wasm' | null
  /** Длина куска параллельного экспорта в секундах; null — как обычно. */
  exportChunkSeconds: number | null
}

function parseChunkSeconds(raw: string | undefined): number | null {
  const value = Number(raw)
  return raw !== undefined && Number.isFinite(value) && value >= 0.5 && value <= 600 ? value : null
}

function parseDelay(raw: string | undefined, max = 5000): number {
  const value = Number(raw)
  return raw !== undefined && Number.isFinite(value) && value >= 0 && value <= max ? value : 0
}

export function parseTestFlags(env: NodeJS.ProcessEnv): TestFlags {
  const isolated = typeof env['FLOW_USER_DATA'] === 'string' && isAbsolute(env['FLOW_USER_DATA'])
  return {
    crash: isolated && env['FLOW_TEST_CRASH'] === '1',
    bench: isolated && env['FLOW_BENCH'] === '1',
    noTips: isolated && env['FLOW_NO_TIPS'] === '1',
    gpuFail: isolated && env['FLOW_TEST_GPU_FAIL'] === '1',
    detectorProbe: isolated && env['FLOW_TEST_DETECTOR'] === '1',
    detectorDebug: isolated && env['FLOW_DETECTOR_DEBUG'] === '1',
    detectorLoadDelayMs: isolated ? parseDelay(env['FLOW_DETECTOR_LOAD_DELAY_MS'], 120_000) : 0,
    detectorStub: isolated && env['FLOW_DETECTOR_STUB'] === '1',
    detectorStubPattern:
      isolated && isAbsolute(env['FLOW_DETECTOR_STUB_PATTERN'] ?? '')
        ? (env['FLOW_DETECTOR_STUB_PATTERN'] as string)
        : null,
    detectorStubDelayMs: isolated ? parseDelay(env['FLOW_DETECTOR_STUB_DELAY_MS']) : 0,
    detectorBackend: isolated && env['FLOW_DETECTOR_BACKEND'] === 'wasm' ? 'wasm' : null,
    exportChunkSeconds: isolated ? parseChunkSeconds(env['FLOW_EXPORT_CHUNK_SEC']) : null
  }
}

export const testFlags = (): TestFlags => parseTestFlags(process.env)
