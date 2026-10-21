# Слежение за игроком — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** кнопка «Следить за игроком» у кольца/круга/прожектора/подписи: детектор находит игроков на кадрах отрезка, трекер ведёт выбранного (с пережиданием столкновений и вопросом «Кто из них ваш?»), результат пишется ключевыми кадрами рисунка.

**Architecture:** main декодирует кадры отрезка ffmpeg'ом и передаёт их в скрытое окно-«детектор» (onnxruntime-web, WebGPU → WASM, модель D-FINE-S). Рамки и приметы возвращаются в main, где чистый TS-трекер (`src/shared/tracking`) ведёт одного игрока и отдаёт траекторию. Интерфейс превращает траекторию в ключи `auto: true` одной операцией истории; экспорт и сохранение работают через существующие ключевые кадры.

**Tech Stack:** Electron 44, TypeScript, zod, onnxruntime-web (MIT), D-FINE-S COCO ONNX (Apache-2.0), ffmpeg-static, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-player-tracking-design.md` (читать целиком, включая «Уточнения» и «Решения после пробного замера»). Цифры замера: `docs/performance.md`, раздел «Слежение: замер моделей». Выкидной код замера (можно подсмотреть, не копировать как есть): `C:\Users\user\AppData\Local\Temp\claude\c--Users-user-projects-flow-analyzer\c00cb4a0-c311-4d74-80dc-ea7807cb72cc\scratchpad\spike\`.

## Global Constraints

- Безопасность Electron как в проекте: contextIsolation, без nodeIntegration, preload + IPC с zod-проверкой (`src/shared/ipc-contract.ts`). Окно-детектор тоже без Node; модель получает байтами от main, не читает файлы сам.
- Лицензии только Apache-2.0/MIT/BSD; модель и onnxruntime-web добавить в `npm run notices` (`licenses/THIRD_PARTY_NOTICES.txt`) с указанием «D-FINE-S, обучено на COCO».
- Файл модели **не коммитить** в git: `scripts/fetch-models.mjs` скачивает по зафиксированному URL и проверяет SHA-256 (взять из файла замера), вызывается из `postinstall` и перед `build:win`; при несовпадении — ошибка сборки. В установщик — через `extraResources` (`resources/models/dfine_s_coco.onnx`), вне asar.
- Размер: +~70 МБ к установленной программе; сверх +100 МБ — стоп и вопрос пользователю.
- Видео пользователя (`C:\Users\user\Videos\flow-samples\`) — только локально; в репозиторий ни видео, ни кадров. Тесты — синтетические фикстуры (`scripts/make-fixtures.mjs`).
- Electron в shell запускать через `env -u ELECTRON_RUN_AS_NODE`; e2e — с существующими хелперами (изолированные `FLOW_USER_DATA`/`FLOW_LIBRARY_DIR`, фоновое окно). Smart App Control не обходить.
- Тексты интерфейса — по-русски в `src/renderer/src/i18n/ru.ts`. Сообщения (дословно):
  - потеря: `Игрок потерян на {time} — {причина}. Поставьте рисунок на игрока и нажмите «Следить» ещё раз.`; причины: `смена плана`, `вышел из кадра`, `закрыт другими игроками`.
  - нет игрока на старте: `Не вижу игрока под рисунком — поставьте рисунок точнее или начните с соседнего кадра.`
  - выбор: `Кто из них ваш? Щёлкните по игроку.`
  - расхождение с правкой: `Слежение расходится с вашей правкой на {time}.`
  - замена ручной анимации: `Заменить {n} ключей после этого места?`
  - поле → экран: `Рисунок «на поле» стал экранным: он будет ехать за игроком, но метры больше не показываются.`
- Версия по завершении: **0.17.0**.

## Review Focus

- Два игрока **одной команды** пересекаются и бегут рядом — трекер не должен молча выбрать не того: либо уверенно по прогнозу, либо вопрос «Кто из них ваш?» (тест в Task 2).
- Детектор на мгновение **сливает двух игроков в одну рамку** (замер: момент m5) — пережидание, не перескок (тест в Task 2).
- **Отрезок начинается на смене плана** или игрок уже за краем кадра на стартовом кадре — сообщение, рисунок не меняется (тест в Task 2 и Task 6).
- **Отмена** посреди расчёта и **закрытие проекта/окна** во время слежения — ни ключей, ни висящих процессов ffmpeg/окна-детектора (тест в Task 5).
- **Видео с началом не в нуле** (start_time 0.04 с, как у файла пользователя) и нецелый fps — ключи по времени совпадают с кадрами экрана и экспорта (тест в Task 3).

---

### Task 1: ключи слежения в формате проекта

**Files:**
- Modify: `src/shared/annotations.ts` (схема ключа: необязательное `auto: z.literal(true)`; `MAX_KEYFRAMES` 200 → 3000; экранному `spot` — необязательное поле луча, по образцу `pspot`)
- Create: `src/shared/tracking/keys.ts`
- Test: `src/shared/tracking/keys.test.ts`, дополнить `src/main/project/compat.test.ts`

**Interfaces:**
- Produces:
  - `interface TrackSample { t: number; foot: {x:number;y:number}; height: number }` — доли кадра, `t` — середина кадра (`frameCenter`).
  - `thinTrack(samples: TrackSample[], tolerance: number): TrackSample[]` — прореживание (Douglas–Peucker по времени; `tolerance` в долях высоты кадра, по умолчанию `2.5/720`).
  - `trackToKeys(a: Annotation, samples: TrackSample[], at: number): Keyframe[]` — смещение и масштаб рисунка относительно рамки игрока на кадре `at` сохраняются; размер следует за `height` (сглаживание скользящим средним 5 кадров); все ключи `auto: true`, `ease: 'linear'`.
  - `mergeTrackedKeys(existing: Keyframe[], tracked: Keyframe[], from: number): { keys: Keyframe[]; replacedManual: number }` — удаляет авто-ключи после `from`, ручные после `from` сохраняет и считает.
  - `pitchToScreenForTracking(a: Annotation, cal: Calibration, t: number): Annotation` — `ring` → `circle` (эллипс по виду на кадре, `underPlayers: true`), `pspot` → `spot` с лучом.

- [ ] **Step 1: тесты** — `thinTrack` на прямой даёт 2 точки, на ломаной сохраняет излом с ошибкой ≤ tolerance; `trackToKeys` для кольца у ног: ключ на каждом оставшемся сэмпле, центр кольца = foot + исходное смещение, радиус растёт в 1,5 раза при росте `height` в 1,5 раза; `mergeTrackedKeys`: 3 ручных до `from` и 2 ручных после → `replacedManual = 0`, ручные сохранены, старые авто после `from` удалены; проект 0.16.4 без `auto` читается; проект с 2500 ключами проходит схему; `pitchToScreenForTracking` даёт `circle` с `underPlayers: true`, `pspot` → `spot` с лучом.
- [ ] **Step 2:** `npx vitest run src/shared/tracking/keys.test.ts src/main/project/compat.test.ts` — FAIL.
- [ ] **Step 3:** реализовать.
- [ ] **Step 4:** те же тесты + `npm run typecheck` — PASS.
- [ ] **Step 5:** commit `Слежение: ключи auto и перевод траектории в ключи`.

### Task 2: трекер одного игрока (чистый TS)

**Files:**
- Create: `src/shared/tracking/types.ts`, `kalman.ts`, `appearance.ts`, `sceneCut.ts`, `tracker.ts`
- Test: `src/shared/tracking/tracker.test.ts`, `appearance.test.ts`, `sceneCut.test.ts`

**Interfaces:**
- Produces:
  - `interface Box { x:number; y:number; w:number; h:number }` (пиксели кадра детектора), `interface Detection { box: Box; score: number; look: Float32Array }` — `look`: HSV-гистограммы верхней и нижней половин рамки, 2×(3×16), нормированные.
  - `interface FrameInput { index: number; t: number; detections: Detection[]; frameHist: Float32Array }` (`frameHist` — гистограмма всего кадра 3×16 для смены плана).
  - `appearanceDistance(a: Float32Array, b: Float32Array): number` (Bhattacharyya, 0..1).
  - `isSceneCut(prev: Float32Array, cur: Float32Array): boolean` — L1 > **0.15** (по замеру: 0.2 пропускает переходы общий→общий).
  - `pickStart(dets: Detection[], anchor: {x:number;y:number}): { kind:'ok'; det: Detection } | { kind:'ambiguous'; candidates: Detection[] } | { kind:'none' }` — ближайшая рамка, у которой нижняя середина/тело содержит якорь; неоднозначно, если вторая по близости ближе чем 1,5× первой или рамки перекрываются (IoU > 0.1) — тогда старт не берёт «грязные» приметы.
  - `class SingleTracker { constructor(start: Detection, fps: number); step(f: FrameInput): StepResult }`, где `StepResult = { kind:'track'; box: Box; coasting: boolean } | { kind:'ask'; candidates: Detection[] } | { kind:'lost'; reason: 'cut'|'out'|'occluded' }`; `resolve(det: Detection): void` — ответ на «Кто из них ваш?».
- Правила (значения стартовые, подстроить в Task 7 и записать):
  - Калман: состояние центр/скорость/высота; сопоставление IoU + расстояние до прогноза + `appearanceDistance` (вес приметы 0.4).
  - Перекрытие (нет рамки с уверенным совпадением или лучшая рамка перекрыта соседней IoU > 0.3, или рамка выросла по ширине > 1.6× — слияние): режим «пережидание» до **25 кадров (1 с)** по прогнозу, приметы не обновляются.
  - Выход из пережидания: кандидаты в радиусе прогноза; лучший по `0.6·appearance + 0.4·расстояние`; если отрыв от второго < 0.15 → `ask`; если кандидатов нет за 1 с → `lost('occluded')`; рамка у края кадра и прогноз за краем → `lost('out')`; `isSceneCut` → `lost('cut')`.
  - Приметы обновляются только на уверенных неперекрытых кадрах (скользящее среднее 0.9/0.1).
- [ ] **Step 1: тесты на синтетических последовательностях рамок** (генератор в тесте): прямой бег — ведёт все кадры; пересечение с игроком **другого** цвета на 12 кадров — после расхождения ведёт своего; пересечение с игроком **того же** цвета, расходятся в разные стороны — ведёт своего по прогнозу; одинаковый цвет и одинаковое направление после разведения — `ask`, `resolve` продолжает; слияние двух рамок в одну широкую на 4 кадра — без перескока; смена плана — `lost('cut')`; уход за край — `lost('out')`; пропадание на 30 кадров — `lost('occluded')`; `pickStart` с якорем между двумя перекрытыми игроками — `ambiguous`, без рамок рядом — `none`.
- [ ] **Step 2:** `npx vitest run src/shared/tracking` — FAIL.
- [ ] **Step 3:** реализовать.
- [ ] **Step 4:** PASS + typecheck.
- [ ] **Step 5:** commit `Слежение: трекер одного игрока с пережиданием столкновений`.

### Task 3: кадры отрезка из ffmpeg

**Files:**
- Create: `src/main/tracking/frames.ts`
- Test: `src/main/tracking/frames.test.ts` (реальный ffmpeg на фикстуре)

**Interfaces:**
- Consumes: путь к ffmpeg и пробник видео — как в `src/main/ffmpeg/` (переиспользовать их функции, не дублировать).
- Produces: `decodeFrames(opts: { videoPath: string; from: number; to: number; width: number; signal: AbortSignal }): AsyncIterable<{ index: number; t: number; rgba: Uint8Array; width: number; height: number }>` — точные кадры по номеру (как экспорт: `-ss` + `trim`/`select` по кадрам), `t` = середина кадра в шкале времени плеера с учётом `start_time` видео; ширина по умолчанию 960 (высота по пропорциям, чётная).
- [ ] **Step 1: тесты:** фикстура с номером кадра, «вшитым» цветом/картинкой: кадры с 2.0 по 3.0 с при 25 fps → ровно 25 кадров, номер в пикселях совпадает с `index`; видео с `start_time` 0.04 (сделать как в `startOffset.test.ts`) — `t` совпадает с тем, что показывает плеер; `abort()` посреди — итератор завершается, процесс ffmpeg закрыт.
- [ ] **Step 2–4:** FAIL → реализовать → PASS.
- [ ] **Step 5:** commit `Слежение: точные кадры отрезка из ffmpeg`.

### Task 4: окно-детектор (onnxruntime-web + D-FINE-S) и модель в сборке

**Files:**
- Create: `scripts/fetch-models.mjs`, `src/main/tracking/detectorWindow.ts`, `src/renderer/detector.html`, `src/renderer/src/detector/main.ts`, `src/renderer/src/detector/postprocess.ts`, `src/preload/detector.ts`
- Modify: `package.json` (зависимость `onnxruntime-web`, `postinstall`), `electron.vite.config.ts` (второй вход renderer и preload), `electron-builder.yml` (`extraResources: resources/models`), `scripts/gen-notices.mjs`/`notices-lib.mjs` (модель и ORT), `.gitignore` (`resources/models/*.onnx`)
- Test: `src/renderer/src/detector/postprocess.test.ts`, `tests/e2e/detector.spec.ts`

**Interfaces:**
- Produces:
  - `createDetector(): Promise<Detector>`; `interface Detector { backend: 'webgpu'|'wasm'; detect(frame: { rgba: Uint8Array; width: number; height: number }, roi?: Box): Promise<{ detections: Detection[]; frameHist: Float32Array }>; close(): void }` — класс COCO «person», порог 0.4; `look` и `frameHist` считаются в окне-детекторе по тем же пикселям.
  - **Окно вокруг игрока:** при заданном `roi` детектор работает по вырезу 640×384 вокруг прогноза (координаты возвращаются в системе кадра); полный кадр — на старте, при `ask`, при выходе из пережидания и каждые 25 кадров.
  - Модель передаётся в окно байтами из main (`fs.readFile` пути `resources/models/dfine_s_coco.onnx` / `process.resourcesPath`), окно сети не использует; CSP окна разрешает только wasm из бандла.
  - Тестовый флаг `FLOW_DETECTOR_BACKEND=wasm` (работает только вместе с `FLOW_USER_DATA`, как прочие тестовые флаги в `src/main/testFlags.ts`).
- [ ] **Step 1: тесты:** `postprocess` на записанном выходе модели (маленький JSON-фикстур из замера) даёт ожидаемые рамки; e2e: детектор создаётся в фоновом окне, на синтетическом кадре с 3 фигурками-людьми (сгенерировать картинку с силуэтами или взять кадр из `make-fixtures`) находит ≥ 1 человека на обоих бэкендах (`webgpu`, `wasm` через флаг), `close()` закрывает окно; `fetch-models.mjs` с неверным SHA-256 падает.
- [ ] **Step 2–4:** FAIL → реализовать → PASS. `npm run notices` обновляет список.
- [ ] **Step 5:** commit `Слежение: окно-детектор onnxruntime-web и модель D-FINE-S`.

### Task 5: задача слежения в main и IPC

**Files:**
- Create: `src/main/tracking/job.ts`, `src/main/ipc/tracking.ts`
- Modify: `src/shared/ipc-contract.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/main/closeGuard.ts` (идёт слежение — отменить при закрытии)
- Test: `src/main/tracking/job.test.ts` (детектор подменяется заглушкой с синтетическими рамками), `tests/e2e/tracking-job.spec.ts`

**Interfaces:**
- Consumes: `decodeFrames` (Task 3), `Detector` (Task 4), `SingleTracker`, `pickStart`, `isSceneCut` (Task 2).
- Produces (IPC, zod-схемы в контракте):
  - `tracking:start` `{ videoPath, from, to, anchor: {x,y} /* доли кадра */ }` → `{ jobId }`
  - событие `tracking:progress` `{ jobId, done, total }`
  - событие `tracking:ask` `{ jobId, t, candidates: Box[] /* доли кадра */ }`; ответ `tracking:resolve` `{ jobId, index }`
  - событие `tracking:done` `{ jobId, samples: TrackSample[], stop: null | { t, reason: 'cut'|'out'|'occluded' } }` или `{ jobId, error: 'no-player'|'ambiguous-start'; candidates?: Box[] }`
  - `tracking:cancel` `{ jobId }`
  - Одна задача одновременно; оценка длительности для предупреждения: `estimateSeconds(durationSec, backend)` по коэффициентам из замера.
- [ ] **Step 1: тесты:** заглушка детектора с бегущей рамкой → `done` с сэмплами на каждый кадр; `ambiguous-start`; `ask` → `resolve` → продолжение; `cancel` → ни `done`, ни процессов ffmpeg (проверить по списку дочерних процессов), окно-детектор закрыто; закрытие главного окна во время слежения — без висящих процессов (e2e).
- [ ] **Step 2–4:** FAIL → реализовать → PASS.
- [ ] **Step 5:** commit `Слежение: задача в main, IPC, отмена`.

### Task 6: интерфейс «Следить за игроком»

**Files:**
- Create: `src/renderer/src/features/tracking/trackingStore.ts`, `TrackButton.tsx`, `PickOverlay.tsx`, `trackingActions.ts`
- Modify: `StyleBar.tsx` (кнопка видна у выбранного `circle`/`spot`/`text`/`ring`/`pspot` с отрезком; у «Только кадр» — нет), `AnnotationTrack.tsx` (авто-ключи — сплошная полоса «слежение», ромбики только у ручных), `annotationsStore.ts`/`history.ts` (применение одной операцией), `ru.ts`, стили
- Test: `src/renderer/src/features/tracking/trackingActions.test.ts`, `tests/e2e/tracking.spec.ts`

**Interfaces:**
- Consumes: IPC из Task 5, `trackToKeys`/`mergeTrackedKeys`/`thinTrack`/`pitchToScreenForTracking` (Task 1).
- Produces: `startTracking(annotationId: string): Promise<void>` — от текущего кадра до конца отрезка; если рисунок растянут дальше последнего ключа — та же кнопка подписана «Продолжить слежение» и стартует с последнего ключа. Перед стартом: отрезок > 60 с → предупреждение `Это займёт около {n} с. Продолжить?`; ручные ключи после текущего кадра → вопрос о замене. Во время: полоса прогресса и «Отмена» (без изменений рисунка при отмене). `ask`/`ambiguous-start` → `PickOverlay` с рамками и текстом `Кто из них ваш? Щёлкните по игроку.`; Esc — отмена. Итог: одна запись в истории (один Ctrl+Z убирает всё слежение и конвертацию «поле → экран»); при `stop` — тост с причиной.
- [ ] **Step 1: тесты:** e2e на синтетической фикстуре «бегущая фигурка» (добавить в `scripts/make-fixtures.mjs`: зелёный фон, 2–3 силуэта человека, один пересекает другого, в конце смена плана): нарисовать кольцо на фигурке → «Следить» → ключи `auto` есть, кольцо на последнем кадре у ног фигурки (±3% кадра), остановка с тостом «смена плана»; Ctrl+Z убирает всё; «Отмена» — без изменений; у рисунка «Только кадр» кнопки нет; ручная правка в середине + «Следить» с этого кадра → ручной ключ сохранён; экспорт клипа с отслеженным кольцом — кольцо в кадре экспорта там же, где на экране (сравнение как в существующих e2e экспорта).
- [ ] **Step 2–4:** FAIL → реализовать → PASS.
- [ ] **Step 5:** commit `Слежение: кнопка, выбор игрока, применение ключами`.

### Task 7: проверка на реальном видео, подстройка, выпуск 0.17.0

**Files:**
- Modify: пороги в `src/shared/tracking/*` (по результатам), `docs/real-video-check.md` (раздел «Слежение за игроком»), `docs/performance.md` (скорость в программе), `README.md` (как пользоваться, ограничения, старые версии не откроют проект с >200 ключами), `package.json`/`package-lock.json`/compat-тест → **0.17.0**

- [ ] **Step 1:** на видео пользователя (локально, скрипты во временной папке) прогнать 10+ моментов через настоящий интерфейс (Playwright, фоновое окно): те же 10 моментов, что в замере (`spike\pick\m1..m10.jpg` — какого игрока брать), плюс 2–3 новых с борьбой игроков одной команды. Для каждого: доведено / честная остановка / вопрос / перескок / преждевременная остановка; время расчёта.
- [ ] **Step 2:** критерий из спеки: **0 перескоков**, ≥ **8 из 10** — до конца или честная остановка (вопрос «Кто из них ваш?» с правильным ответом считается успехом). Не дотягивает после разумной подстройки порогов — стоп, отчёт автору плана с цифрами, без новых слоёв.
- [ ] **Step 3:** скорость: время на 10 с видео (WebGPU и WASM) — в `docs/performance.md`; размер установщика (`npm run build:win`) — записать.
- [ ] **Step 4:** все проверки: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` — зелёные.
- [ ] **Step 5:** скриншоты и короткий экспорт 3 моментов для пользователя — в `C:\Users\user\Pictures\FlowAnalyzer-проверка\` (не в репозиторий). Commit `Версия 0.17.0: слежение за игроком` — только после согласия пользователя.
