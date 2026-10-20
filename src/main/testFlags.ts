// Тестовые возможности приложения. Работают ТОЛЬКО когда задана отдельная папка данных FLOW_USER_DATA
// (так запускаются автотесты и замеры): у обычного пользователя эта переменная не задана, и все флаги выключены.
//   FLOW_TEST_CRASH=1 — интерфейс получает функцию, которая нарочно ломает отрисовку (проверка экрана ошибки).
//   FLOW_BENCH=1      — интерфейс получает функции замера (сборка снимка проекта, автосохранение).
//   FLOW_NO_TIPS=1    — подсказки первого запуска не показываются сами (иначе они мешали бы остальным автотестам).
import { isAbsolute } from 'path'

export interface TestFlags {
  crash: boolean
  bench: boolean
  noTips: boolean
}

export function parseTestFlags(env: NodeJS.ProcessEnv): TestFlags {
  const isolated = typeof env['FLOW_USER_DATA'] === 'string' && isAbsolute(env['FLOW_USER_DATA'])
  return {
    crash: isolated && env['FLOW_TEST_CRASH'] === '1',
    bench: isolated && env['FLOW_BENCH'] === '1',
    noTips: isolated && env['FLOW_NO_TIPS'] === '1'
  }
}

export const testFlags = (): TestFlags => parseTestFlags(process.env)
