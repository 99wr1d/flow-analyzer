import { defineConfig } from 'vitest/config'

// Замеры скорости экспорта (npm run bench:export): отдельная настройка, в обычный npm test они не входят.
export default defineConfig({
  test: {
    include: ['tests/bench/**/*.bench.ts'],
    fileParallelism: false,
    testTimeout: 3 * 3600_000
  }
})
