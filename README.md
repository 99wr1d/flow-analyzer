# FlowAnalyzer

Футбольный видеоанализатор — настольное приложение (Electron + React + TypeScript).
Сейчас готов каркас: безопасное окно, тёмный интерфейс и установщик для Windows.
Дальше: импорт и плеер видео, рисование поверх видео, таймлайн с метками, проекты, экспорт в MP4, трекинг игроков, клипы и статистика.

## Требования

- Windows 10/11
- Node.js 24
- npm

## Команды

```bash
npm install          # установить зависимости
npm run dev          # запустить приложение в режиме разработки
npm run lint         # проверка кода
npm run typecheck    # проверка типов
npm test             # юнит-тесты (vitest)
npm run test:e2e     # сборка + smoke-тест приложения в Electron (Playwright)
npm run build:win    # установщик: dist/FlowAnalyzer-Setup-0.1.0.exe
```

## Важно про запуск из VS Code

Терминалы и инструменты внутри VS Code могут выставлять переменную окружения
`ELECTRON_RUN_AS_NODE=1`. С ней Electron запускается как обычный Node.js и окно не появляется.
Перед `npm run dev` или запуском приложения эту переменную нужно убрать:

```bash
# Git Bash
env -u ELECTRON_RUN_AS_NODE npm run dev
# PowerShell
Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run dev
```

## Установщик и SmartScreen

Установщик пока не подписан сертификатом, поэтому Windows SmartScreen покажет предупреждение.
Нажмите «Подробнее» → «Выполнить в любом случае».

## Безопасность

- `contextIsolation` включён, `nodeIntegration` выключен, `sandbox` включён.
- Интерфейс получает только функции из `window.api` (описаны в `src/shared/ipc-contract.ts`).
- Навигация и новые окна блокируются, разрешения (камера, микрофон и т. д.) отклоняются.
- Строгая Content-Security-Policy в `src/renderer/index.html`.

## Структура

```
src/main        основной процесс (окно, безопасность, IPC-обработчики)
src/preload     безопасный мост window.api
src/shared      контракт IPC (каналы и типы)
src/renderer    интерфейс (React): app, ui, i18n, styles
tests/e2e       smoke-тест Playwright
build           иконки (icon.svg — исходник)
```
