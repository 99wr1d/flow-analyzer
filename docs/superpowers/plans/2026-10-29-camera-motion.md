# Учёт движения камеры — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Слежение и рисунки «На поле» учитывают движение камеры: рамки игроков переводятся в координаты опорного кадра до трекера, разметка поля переносится на другие кадры.

**Architecture:** Чистый модуль `src/shared/camera/` оценивает преобразование фона между соседними кадрами (углы + поток Лукаса–Канаде + RANSAC на `fitHomography`) и накапливает цепочки с флагами надёжности. `src/main/camera/` кормит его кадрами из `decodeFrames`. `job.ts` оборачивает трекер (рамки туда и обратно), `tracker.ts` / `multi.ts` не меняются. Рисунки «На поле» получают проектор на момент t композицией разметки и движения.

**Tech Stack:** TypeScript, vitest, Playwright e2e, ffmpeg (существующий), zod (кэш в проекте).

**Spec:** `docs/superpowers/specs/2026-10-29-camera-motion-design.md`

## Global Constraints

- Только TS/WASM внутри существующих процессов; без OpenCV-бинарников, нативных DLL, внешних моделей и платных API.
- `src/shared/tracking/tracker.ts` и `multi.ts` не менять; сценарии near/doubt/hjump/tall/adv в `tracker.test.ts` проходят без правок.
- Ложный сдвиг хуже его отсутствия: ненадёжный кадр = поведение как сегодня.
- Смена плана (`sceneCut.ts`) обрывает цепочку движения.
- Экран = экспорт (одни матрицы на экране и в экспорте).
- Старые проекты без кэша открываются и ведут себя как раньше.
- Кадры оценки камеры — ширина 480 px, каждый кадр подряд, один проход ffmpeg с детектором.
- Кэш: преобразования кадр→соседний кадр, версия алгоритма; инвалидация по видео (путь+размер+время) и версии.
- Запуск Electron в фоне: `env -u ELECTRON_RUN_AS_NODE`, `FLOW_BACKGROUND_WINDOW=1`. Полный `npm test` зависает под нагрузкой — гонять частями (`src/shared src/renderer src/main/board src/main/ipc`, затем остальной `src/main`). Два каталога e2e одновременно не запускать.
- Видео из `C:\Users\user\Videos\flow-samples` не коммитить. Комментарии в коде и тексты UI — по-русски, как вокруг.

## Review Focus

1. Чёрный/однородный кадр, затемнение при смене плана: «ненадёжно», а не единичная матрица с ложной надёжностью.
2. Кадр, почти целиком занятый игроками (крупный план): мало фона → ненадёжно, трекер получает рамки как есть.
3. Неподвижная камера: матрица ≈ единичная, ничего не дрожит (шум оценки не должен «качать» кольцо).
4. Зум-аут/ин на 2–3× за секунду: цепочка не рвётся без причины и не копит масштабный дрейф.
5. Обрыв цепочки посреди рисунка «На поле»: рисунок возвращается к старому поведению с предупреждением, а не пропадает.

---

## File Structure

- Create `src/shared/camera/types.ts` — `FrameMotion`, `MotionChain`, константы порогов.
- Create `src/shared/camera/chain.ts` — накопление и композиция цепочки (`toReference`, `between`).
- Create `src/shared/camera/estimate.ts` — оценка движения между двумя серыми кадрами.
- Create `src/shared/camera/cache.ts` — zod-схема кэша и версия алгоритма.
- Create `src/shared/pitch/cameraProjector.ts` — проектор разметки на момент t.
- Create `src/main/camera/gray.ts`, `src/main/camera/estimator.ts` — потоковая оценка по `DecodedFrame`.
- Create `src/main/camera/cameraIpc.ts` (+ регистрация в `src/main/ipc`) — «оценить камеру на [from,to]».
- Modify `src/main/tracking/job.ts` — обёртка трекера; `src/renderer/src/features/tracking/trackingApply.ts`, `trackingActions.ts` — рисунки «На поле» остаются на поле; `usePitch.ts`, `AnnotationLayer.tsx`, `renderOverlays.tsx` — проектор на момент t; `src/shared/project.ts`, `src/main/project/session.ts` — кэш; `ru.ts` — тексты.
- Test: рядом с файлами (`*.test.ts`), e2e — `tests/e2e/camera.spec.ts`.

---

### Task 1: Типы и цепочка движения

**Files:** Create `src/shared/camera/types.ts`, `src/shared/camera/chain.ts`; Test `src/shared/camera/chain.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FrameMotion { index: number; H: Mat3 /* кадр index−1 → кадр index, доли кадра */; reliable: boolean; inliers: number }
  export class MotionChain {
    push(m: FrameMotion): void
    /** Матрица кадр from → кадр to (from ≤ to или наоборот); null, если на пути есть ненадёжный кадр или обрыв. */
    between(from: number, to: number): Mat3 | null
    /** Обрыв (смена плана): всё до index не связано с тем, что после. */
    cut(index: number): void
    toJSON(): FrameMotion[]; static from(list: FrameMotion[]): MotionChain
  }
  ```
- Consumes: `Mat3`, `mul3`, `inv3`, `IDENTITY3` из `src/shared/pitch/linalg.ts`.

- [ ] **Step 1:** Тесты `chain.test.ts`: `between(a,a)` = единичная; три сдвига +10 px по x → `between(0,3)` = сдвиг +30, `between(3,0)` = −30; ненадёжный кадр посередине → `null`; после `cut(5)` `between(4,6)` = `null`; round-trip `from(toJSON())` даёт те же матрицы.
- [ ] **Step 2:** Запустить `npx vitest run src/shared/camera/chain.test.ts`; ожидаем FAIL (нет модуля).
- [ ] **Step 3:** Реализовать `MotionChain` и типы; `between` — композиция по индексам (префиксные произведения не нужны, достаточно прямого перемножения; ограничить длину окна константой `MAX_CHAIN_SPAN = 2000`, дальше `null`).
- [ ] **Step 4:** Тест проходит; `npm run typecheck` — 0 ошибок.
- [ ] **Step 5:** Commit `Камера: цепочка движения`.

### Task 2: Оценка движения между двумя кадрами

**Files:** Create `src/shared/camera/estimate.ts`; Test `src/shared/camera/estimate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Gray { width: number; height: number; data: Uint8Array }
  export interface EstimateOptions { masks: readonly { x:number;y:number;w:number;h:number }[] /* рамки игроков, доли кадра */ }
  export function estimateMotion(prev: Gray, cur: Gray, opts: EstimateOptions): { H: Mat3; reliable: boolean; inliers: number; rms: number }
  ```
- Consumes: `fitHomography`, `applyH` из `src/shared/pitch/homography.ts` (для RANSAC-подгонки по 4 точкам и итоговой подгонки по inliers).

- [ ] **Step 1:** Тест-генератор: синтетическая сцена (шум-текстура 480×270 с линиями) сдвигается/масштабируется известным `Mat3`; тесты: (а) сдвиг (+7, −3) px → оценка в пределах 0.3 px; (б) зум 1.05 + сдвиг → ошибка угловых точек < 0.5 px; (в) то же с «игроками» — прямоугольниками, движущимися иначе, внутри `masks` → оценка не сбита; (г) однородный серый кадр → `reliable: false`; (д) два несвязанных кадра (смена плана) → `reliable: false`; (е) нулевое движение с шумом ±2 уровня → `H` ≈ единичная (сдвиг < 0.1 px), `reliable: true`.
- [ ] **Step 2:** Запустить, ожидаем FAIL.
- [ ] **Step 3:** Реализовать: углы Ши–Томаси по сетке (≥ 150 точек вне `masks` и вне 5 % у краёв), пирамидальный LK (3 уровня), RANSAC (детерминированный ГПСЧ с фиксированным зерном) с порогом ошибки 1.5 px, итоговая подгонка по inliers; `reliable` — inliers ≥ 40 и ≥ 40 % точек, разброс inliers по кадру (площадь выпуклой оболочки ≥ 15 % кадра), rms ≤ 1 px; при малом числе/разбросе падать на подобие (сдвиг+масштаб). Пороги — именованными константами в `types.ts`.
- [ ] **Step 4:** Тесты проходят; typecheck.
- [ ] **Step 5:** Commit `Камера: оценка движения между кадрами`.

### Task 3: Потоковая оценка по кадрам видео

**Files:** Create `src/main/camera/gray.ts`, `src/main/camera/estimator.ts`; Test `src/main/camera/estimator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function toGray(frame: DecodedFrame, width?: number /* 480 */): Gray
  export class CameraEstimator {
    constructor(chain?: MotionChain)
    /** Кадры подаются по порядку; boxes — рамки игроков (доли кадра) для маски. Возвращает движение относительно предыдущего. */
    push(frame: DecodedFrame, boxes: readonly Box[], cut: boolean): FrameMotion | null /* null на первом кадре */
    readonly chain: MotionChain
  }
  ```
- Consumes: `estimateMotion` (Task 2), `MotionChain` (Task 1), `DecodedFrame` из `src/main/tracking/frames.ts`.

- [ ] **Step 1:** Тест: поток из 10 синтетических `DecodedFrame` с панорамой 3 px/кадр → `chain.between(0, 9)` ≈ сдвиг 27 px (в долях ширины) в пределах 1 px; кадр с `cut: true` → `chain.between(4,6)` = `null`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализовать `toGray` (RGBA → яркость, уменьшение усреднением по блокам) и `CameraEstimator.push`.
- [ ] **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `Камера: потоковая оценка`.

### Task 4: Замер на настоящем видео (ВОРОТА — результат показать пользователю)

**Files:** Create `scripts/camera-measure.ts` (запуск вручную, в репозитории), результаты — в `docs/camera-motion-check.md`.

- [ ] **Step 1:** Скрипт: берёт видео из `Videos\flow-samples`, и список моментов из `Pictures\FlowAnalyzer-кольца\диагностика\проверка-195\моменты.json`; декодирует окна по 6 с, гоняет `CameraEstimator` (без детектора, без масок), печатает долю надёжных кадров и скорость (кадров/с).
- [ ] **Step 2:** Для 10+ моментов с заметной панорамой: поставить на двух кадрах окна разметку поля по линиям (скриптом по заранее выбранным 4 точкам из `моменты.json`/вручную), перенести первую на вторую цепочкой, посчитать расхождение в метрах (`ground.ts`).
- [ ] **Step 3:** Записать в `docs/camera-motion-check.md`: доля надёжных кадров, скорость, расхождение в метрах (медиана/p90), примеры провалов. Приложить 6 снимков «перенос против эталона» в `Pictures\FlowAnalyzer-камера\`.
- [ ] **Step 4:** Если расхождение p90 > 0.5 м или надёжных < 80 % на панорамах — остановиться и показать пользователю (подбор порогов/метода — отдельное решение); иначе зафиксировать порог в `types.ts` как `PITCH_DRIFT_LIMIT_M`.
- [ ] **Step 5:** Commit `Камера: замер на реальном видео`.

### Task 5: Обёртка трекера (шаг 1 — слежение)

**Files:** Modify `src/main/tracking/job.ts`, `src/main/tracking/stubDetector.ts` (панорама в сценариях); Test `src/main/tracking/job.camera.test.ts`

**Interfaces:**
- Consumes: `CameraEstimator`, `MotionChain.between`.
- Produces: `RunTrackingOptions.camera?: CameraEstimator`; в `TrackingOutcome.done` — `cameraReliable: number` (доля надёжных кадров, для журнала).

Правила обёртки: перед `tracker.step` рамки `out.detections` переводятся в координаты опорного кадра отрезка (`between(index, refIndex)`); `predictBoxes` и `askBox` переводятся обратно в экран перед вырезом детектора и вопросом; `boxToSample` получает рамку в экране кадра k. Если кадр ненадёжен — рамки идут как есть; при смене надёжного/ненадёжного состояния опорный кадр перебирается заново (новый `refIndex`), трекер продолжает без перезапуска.

- [ ] **Step 1:** Тесты на заглушке: (а) игрок стоит, камера делает панораму 40 px/кадр → без камеры слежение теряет игрока (`stop`), с камерой — идёт до конца без вопросов и ключи едут по экрану вместе с фоном; (б) два игрока рядом, панорама → нет перескока на соседа; (в) `camera` не передана → результат идентичен прежнему (golden: прежние тесты `job.test.ts` проходят без правок); (г) ненадёжные кадры посреди панорамы → поведение как без камеры, без исключений.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализовать обёртку в цикле `runTrackingJob`; `CameraEstimator.push` вызывается после детектора (маски — его рамки) и до `tracker.step`; cut — по `isSceneCut`, как уже делает трекер (передать флаг из `out.frameHist` и предыдущей гистограммы).
- [ ] **Step 4:** `npx vitest run src/main/tracking src/shared/tracking` — PASS полностью, включая `tracker.test.ts` без правок.
- [ ] **Step 5:** Commit `Слежение: учёт движения камеры`.

### Task 6: Прогон 195 случаев и сравнение (ВОРОТА)

- [ ] **Step 1:** Включить камеру в IPC слежения (создание `CameraEstimator` в `src/main/ipc` у задачи слежения, флаг `FLOW_CAMERA=0` отключает для сравнения).
- [ ] **Step 2:** Прогнать harness `проверка-195` (скрипты в `Pictures\FlowAnalyzer-кольца\диагностика\скрипты`, положить во временную папку `.superpowers/rings/`) с камерой и без.
- [ ] **Step 3:** Критерий: ≥ 177/195 строго; на моментах с движением камеры (≥ 10 отобрать по доле надёжных кадров из Task 4) — меньше вопросов/мин, остановок и перескоков, чем без камеры. Записать таблицу в `docs/camera-motion-check.md`.
- [ ] **Step 4:** Если хуже — не идти дальше: разобрать провалы и показать пользователю.
- [ ] **Step 5:** Commit `Слежение: сравнение 195 случаев с камерой`.

### Task 7: Проектор на момент t

**Files:** Create `src/shared/pitch/cameraProjector.ts`; Test `src/shared/pitch/cameraProjector.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CameraStatus = 'exact' | 'moved' | 'stale' | 'none'
  export function projectorAt(
    c: Calibration, chain: MotionChain | null, calFrame: number, frame: number
  ): { projector: Projector | null; status: CameraStatus }
  ```
  `exact` — тот же кадр; `moved` — перенос по надёжной цепочке; `stale` — цепочка оборвана/ненадёжна (старое поведение + предупреждение); `none` — без разметки.
- Consumes: `projectorFor`, `makeProjector` (`calibration.ts`, `projector.ts`), `MotionChain.between`.

- [ ] **Step 1:** Тесты: линия на разметке при сдвиге камеры на +0.1 кадра по x → `toImage` сдвинут на 0.1; тот же результат, что разметка, поставленная заново на сдвинутом кадре (в допуске 1e-6); обрыв цепочки → `status: 'stale'`; `chain = null` → прежнее поведение (`CALIBRATION_VALIDITY`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализовать: `H_t = M(calFrame→frame) · H_cal` (согласовать порядок с `Mat3`-соглашением файла, проверить тестом).
- [ ] **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `Поле: проектор с учётом камеры`.

### Task 8: Кэш движения в проекте и фоновая оценка

**Files:** Create `src/shared/camera/cache.ts`, `src/main/camera/cameraIpc.ts`; Modify `src/shared/project.ts`, `src/main/project/session.ts`, `src/renderer/src/features/project/snapshot.ts`/`dirty.ts`; Test `src/shared/camera/cache.test.ts`, `src/main/camera/cameraIpc.test.ts`

**Interfaces:**
- Produces: `CAMERA_ALGO_VERSION = 1`; `CameraCacheSchema` = `{ version, video: {path,size,mtime}, spans: { from:number /* кадр */, motions: FrameMotion[] }[] }` (ограничение размера — не больше 400 000 кадров); IPC `camera:estimate({from,to}) → {coverage}` (лениво добавляет span в кэш); поле `cameraCache` в проекте со значением по умолчанию `null`.

- [ ] **Step 1:** Тесты: схема отбрасывает чужую версию/другое видео (кэш → `null`, проект открывается); проект старого формата без поля открывается; round-trip сохранения; IPC на заглушке: повторный запрос того же окна не декодирует заново.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализовать схему, интеграцию в сохранение/открытие, IPC (окно декодируется `decodeFrames` с шириной 480, один `CameraEstimator`, без детектора).
- [ ] **Step 4:** `npx vitest run src/shared src/main/project src/main/camera src/main/ipc` — PASS.
- [ ] **Step 5:** Commit `Камера: кэш в проекте и фоновая оценка`.

### Task 9: Экран и экспорт: рисунки «На поле» едут с камерой

**Files:** Modify `src/renderer/src/features/pitch/usePitch.ts`, `AnnotationLayer.tsx`, `src/renderer/src/features/export/renderOverlays.tsx`, `src/renderer/src/i18n/ru.ts`; Test `usePitch.test.ts`/`renderOverlays.test.ts`, `tests/e2e/camera.spec.ts`

**Interfaces:**
- Consumes: `projectorAt`, кэш из Task 8, IPC `camera:estimate`.
- Правило: при показе или экспорте рисунка «На поле» на кадре вне окна `CALIBRATION_VALIDITY` рендерер запрашивает оценку окна [время разметки, время кадра] (экспорт — только окна рисунков «На поле»); пока оценка идёт — старое поведение; `status: 'stale'` → прежнее предупреждение, текст «Камера двигалась слишком резко, рисунок «на поле» может уплыть».

- [ ] **Step 1:** Тесты: `renderOverlays` на кадре со сдвигом камеры строит линию, совпадающую с `projectorAt(...)`, а не со старой; `stale` даёт предупреждение; старый проект (без кэша) рендерится идентично прежнему (golden `oldLook`).
- [ ] **Step 2:** e2e `camera.spec.ts`: видео-фикстура с панорамой (сгенерировать ffmpeg из `pitch.mp4`/синтетики, положить в `tests/fixtures`, малого размера); поставить разметку, линию на траве, перейти на кадр после панорамы → линия совпадает с линией разметки поля (проверка по пикселям в допуске 3 px) на экране и в готовом экспортированном видео.
- [ ] **Step 3:** FAIL.
- [ ] **Step 4:** Реализовать; прогнать `npx vitest run src/renderer src/shared`, e2e `camera.spec.ts pitch.spec.ts export-drawings.spec.ts under.spec.ts`.
- [ ] **Step 5:** Commit `Рисунки «На поле» едут с камерой`.

### Task 10: Слежение за рисунком «На поле» остаётся на поле

**Files:** Modify `src/renderer/src/features/tracking/trackingApply.ts`, `trackingActions.ts` (`pitchToScreenForTracking`, ветка `a.space === 'pitch'`); Test `trackingActions.test.ts`, `tests/e2e/tracking.spec.ts`

- Правило: если на всём отрезке слежения цепочка надёжна — ключи пишутся в метрах (`keyframes.center` у `ring`, и аналоги других типов), переводом экранного положения ног проектором `projectorAt` на кадр k (`toWorld`); иначе — прежнее превращение в экранный рисунок с подсказкой.

- [ ] **Step 1:** Тесты: слежение за кольцом «На поле» при панораме → ключи в метрах, метры меняются плавно (скорость игрока ≤ 12 м/с); ненадёжная цепочка → превращение в экранный рисунок, как раньше (текст подсказки прежний); экранные рисунки не затронуты.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Прогон: `npx vitest run src/renderer`, e2e `tracking.spec.ts link-tracking.spec.ts animation.spec.ts`.
- [ ] **Step 5:** Commit `Слежение за рисунком «На поле» без превращения`.

### Task 11: Журнал, версия, итоговая проверка (ВОРОТА — результат показать пользователю)

- [ ] **Step 1:** В журнал слежения (`userData/logs`) писать долю надёжных кадров камеры; подсказка в UI при `cameraReliable < 0.5`: «Камеру удалось отследить плохо — возможны вопросы».
- [ ] **Step 2:** Версия 0.21.0 (`package.json`, О программе, README: что нового и известные ограничения — зум в крупный план, резкие смены плана).
- [ ] **Step 3:** Полный прогон по частям: `npm run typecheck`, `npm run lint`, `npx vitest run` частями, `npm run test:e2e` (фоново), `npm run build:win`.
- [ ] **Step 4:** Снимки для пользователя в `Pictures\FlowAnalyzer-камера\` (линия «На поле» до/после панорамы, экран и экспорт; слежение на панораме) + `SendUserFile`; ждать оценки пользователя.
- [ ] **Step 5:** Commit `Версия 0.21.0: учёт движения камеры`. Влитие в `main` и пуш — только по решению пользователя.

---

## Self-Review

- Покрытие спеки: оценка (1–3), слежение (5–6), поле на экране/в экспорте (7, 9), слежение за «На поле» (10), кэш (8), сообщения и журнал (9, 11), проверка (4, 6, 11). Хранение кадр→кадр — Task 1/8; ленивые окна — Task 8/9; обёртка без правок трекера — Task 5.
- Типы: `FrameMotion`, `MotionChain.between`, `Gray`, `CameraEstimator.push` используются одинаково в Tasks 1–9.
- Предупреждение: Task 2 (параметры RANSAC/LK) и Task 4 (порог дрейфа) определяются измерениями; ворота в Tasks 4, 6, 11 — остановка и показ пользователю при провале критериев.
