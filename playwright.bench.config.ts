import { defineConfig } from '@playwright/test'

// Замеры производительности (npm run bench). Не входят в обычный прогон автотестов.
export default defineConfig({
  testDir: 'tests/bench',
  timeout: 45 * 60_000,
  workers: 1,
  reporter: 'list'
})
