# Доска тренера — этап 1 (рабочая доска с основным набором) — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Режим «Доска» в FlowAnalyzer: рисованное поле без видео, вратари/игроки/тренеры в позах с 8 направлениями, инвентарь, кружки, стрелки, карандаш, текст, номера, зоны, анимация по кадрам (позиция, поза, сторона, появление/исчезновение), «Сохранить картинку» (PNG), «Сохранить видео» (MP4), сохранение и повторное открытие доски.

**Architecture:** Доска — отдельный документ `.flowboard` (своя zod-схема в `src/shared/board/`, видео нет; формат `.flowproj` не трогаем). Модель анимации — свои кадры: у элемента базовое состояние + разреженные «состояния в кадре»; между кадрами геометрия плавно, поза/сторона — сменой, появление — проявлением. Рисует всё один чистый SVG-компонент `BoardScene` (и экран, и экспорт через `renderToStaticMarkup` → canvas → PNG); линии/текст/зоны переиспользуют `ShapeView`. MP4 — новая ветка в main: последовательность PNG → ffmpeg (libx264), без исходного видео.

**Tech Stack:** Electron + electron-vite + React 19 + TS, zustand, zod v4, Vitest, Playwright Electron, ffmpeg-static.

**Spec:** `docs/superpowers/specs/2026-10-23-coach-board-design.md`

**Рабочий каталог:** `C:\Users\user\projects\flow-analyzer-board` (git worktree, ветка `feature/coach-board` от `main`). Параллельно в `C:\Users\user\projects\flow-analyzer` идёт «Связка игроков» — e2e двух каталогов одновременно не запускать.

**Этап 2 (отдельный план, после этого):** остальные позы Goalkeeper Studio, остальной инвентарь, остальные виды поля, пунктир «петлёй», цвет формы по разделу целиком.

## Global Constraints

- Все картинки (поля, фигуры, инвентарь) — свои SVG/TSX в репозитории. Ничего не брать из Goalkeeper Studio (картинки, логотипы, щиты «GOALKEEPERSTUDIO.COM», тексты).
- Фигуры — рисованные люди с человеческими пропорциями (голова, шея, плечи, локти, колени, перчатки у вратаря, гетры, бутсы, мягкая светотень, тень под ногами). Образцы: `.superpowers/brainstorm/342-1792741045/content/figures-v2.html`, `angles.html` в основном каталоге `C:\Users\user\projects\flow-analyzer` — открыть, посмотреть, рисовать не хуже.
- Стиль поля — «Иллюстрация»: плоское рисованное поле, полосы газона, белая разметка, ворота с сеткой.
- 8 направлений: `front`, `front-right`, `right`, `back-right`, `back`, `back-left`, `left`, `front-left`. Рисуются 5 (`front`, `front-right`, `right`, `back-right`, `back`), `*-left` — зеркало соответствующего `*-right`.
- Все новые горячие клавиши — через реестр команд (`src/renderer/src/features/commands/definitions.ts`), настраиваемые.
- Интерфейс на русском; строки — в `src/renderer/src/i18n/ru.ts` (раздел `board`).
- zod на всех входах IPC; contextIsolation; никаких фиктивных кнопок.
- Картинка читается на проекторе: PNG 1920×1080; толщина стрелок по умолчанию не тоньше 0.006 высоты, цвета насыщенные.
- E2E — в фоне (`FLOW_BACKGROUND_WINDOW=1` ставится хелпером `launch`), свои `FLOW_USER_DATA`/`FLOW_LIBRARY_DIR`.
- Electron из shell запускать через `env -u ELECTRON_RUN_AS_NODE`.
- Не трогать `src/renderer/src/features/annotations/AnnotationLayer.tsx`, `PitchShapeView.tsx`, `src/shared/pitch/*`, `src/shared/tools/screenPaint.ts` (их меняет «Связка» — будут конфликты). `ShapeView.tsx` и `annotations.ts` — только читать/импортировать.
- Проверки после каждой задачи: `npm run lint`, `npm run typecheck`, `npm test`; e2e — где сказано.

## Review Focus

- Открытие повреждённого или более нового `.flowboard` → понятное сообщение, программа не падает, карточка помечена ошибкой (Task 1, Task 8).
- Удаление кадра, в котором у элементов есть состояния или в котором элемент появляется/исчезает → состояния сдвигаются, элементы без единого видимого кадра удаляются, остальные не «прыгают» (Task 3).
- Отмена (Ctrl+Z) после операций с кадрами возвращает и доску, и номер текущего кадра (Task 10).
- Несохранённая доска + «← Главная» / закрытие окна → вопрос «Сохранить?», как у проектов (Task 12).
- Название доски с недопустимыми для имени файла символами (`/ \ : * ? " < > |`) → имя файла очищено, сохранение не падает (Task 8).

---

## Структура файлов

```
src/shared/board/
  schema.ts        — zod-схема доски, элементы, константы, parse/serialize
  resolve.ts       — состояние элемента в кадре, сцена в момент t, длительность
  edit.ts          — чистые операции правки (добавить, сдвинуть, поза, кадры…)
  ids.ts           — перечни видов поля, поз, инвентаря (общие для main/renderer)
src/renderer/src/features/board/
  art/pitchViews.tsx     — фоны видов поля
  art/figures/*.tsx      — рисунки поз (по файлу на набор: gk.tsx, player.tsx, coach.tsx)
  art/figureArt.tsx      — FigureArt: выбор рисунка, зеркало, цвета формы
  art/equipment.tsx      — инвентарь
  BoardItemView.tsx      — рисует любой элемент доски
  BoardScene.tsx         — фон + элементы в момент t
  boardRender.ts         — SVG-строка и PNG-кадры для экспорта
  boardStore.ts          — состояние редактора (доска, кадр, инструмент, выделение, история)
  boardActions.ts        — сохранить/открыть/экспорт (вызовы window.api)
  BoardEditor.tsx        — экран редактора (раскладка A)
  BoardCanvas.tsx        — поле + мышь (размещение, выделение, рисование)
  BoardTray.tsx, BoardFrames.tsx, BoardViews.tsx, BoardRail.tsx
src/main/board/
  files.ts         — чтение/запись/список .flowboard в папке «Доски»
  video.ts         — аргументы ffmpeg и запуск MP4 из PNG
src/main/ipc/board.ts  — обработчики IPC доски
tests/e2e/board.spec.ts
```

---

### Task 1: Схема доски

**Files:**
- Create: `src/shared/board/ids.ts`, `src/shared/board/schema.ts`
- Test: `src/shared/board/schema.test.ts`

**Interfaces:**
- Produces:
  - `ids.ts`: `PITCH_VIEW_IDS = ['box-front','half-angle','full-top'] as const`; `type PitchViewId`. `FIGURE_SETS = ['gk','player','coach'] as const`; `type FigureSet`. `FIGURE_POSES: Record<FigureSet, readonly string[]>` = `gk: ['set','step','dive-low','dive-high','high-catch','smother']`, `player: ['stand','run']`, `coach: ['stand-ball','throw']`; `type FigurePose = string`. `FACINGS` (8 направлений, порядок как в Global Constraints); `type Facing`. `EQUIPMENT_IDS = ['ball','disc','cone','mannequin','mini-goal'] as const`; `type EquipmentId`.
  - `schema.ts`:
    - `BOARD_FORMAT = 'flowanalyzer-board'`, `BOARD_VERSION = 1`, `BOARD_EXTENSION = 'flowboard'`.
    - `MAX_FRAMES = 50`, `MAX_ITEMS = 500`, `MIN_TRANSITION = 0.3`, `MAX_TRANSITION = 5`, `DEFAULT_TRANSITION = 1`, `MAX_TITLE = 120`, `MAX_TOKEN_LABEL = 2`.
    - Элементы (`BoardElementSchema`, discriminatedUnion по `kind`):
      - `figure` `{kind, set: FigureSet, pose: string, facing: Facing, pos: Point, scale: 0.2..4, rotation: -180..180, color: '#rrggbb'}` — `pos` = точка между ступнями; superRefine: `pose ∈ FIGURE_POSES[set]`.
      - `equip` `{kind, item: EquipmentId, pos, scale, rotation, color}`.
      - `token` `{kind, pos, scale, color, label: string ≤ MAX_TOKEN_LABEL}` (кружок).
      - `number` `{kind, pos, scale, color, n: int 1..99}`.
      - `wavy` `{kind, p1, p2, color, width}` (волнистая стрелка «змейка»).
      - `hatch` `{kind, shape: 'rect'|'tri'|'ellipse', p1, p2, color}` (заштрихованная зона).
      - `shape` `{kind, ann}` — `ann` = экранный рисунок из `AnnotationSchema` типов `arrow|line|circle|text|curve|pen|zone` **без** полей `timing` и `keyframes` (схема: `.omit({timing:true, keyframes:true})` у каждого из семи).
    - `BoardStateSchema` `{frame: int ≥ 1, geom?: Record<string, unknown>, pose?: string, facing?: Facing}`.
    - `BoardItemSchema` `{id: uuid, show: {from: int ≥ 0, to: int ≥ from}, el: BoardElement, states: BoardState[] (≤ MAX_FRAMES, frame строго растёт, frame > show.from)}`.
    - `BoardSchema` `{format, version, title, view: PitchViewId, frameCount: 1..MAX_FRAMES, transition, items ≤ MAX_ITEMS, createdAt, updatedAt (ISO), thumb?: string (data:image/jpeg;base64, ≤ 80 000 символов)}`; superRefine: `show.to < frameCount`, все `states[].frame < frameCount`.
    - `type Board`, `BoardItem`, `BoardElement`, `BoardState`.
    - `newBoard(title: string, now: Date): Board` — один кадр, вид `box-front`, пусто.
    - `parseBoardText(text: string): {ok: true, board: Board} | {ok: false, error: 'json'|'format'|'newer'|'invalid', message: string}` — `version > BOARD_VERSION` → `'newer'`.
    - `boardToFile(board: Board): string` (JSON, 2 пробела).
    - `GEOM_KEYS: Record<BoardElement['kind'], readonly string[]>` — `figure|equip: ['pos','scale','rotation']`, `token|number: ['pos','scale']`, `wavy|hatch: ['p1','p2']`; для `shape` — `GEOM_FIELDS[ann.type]` из `src/shared/animation.ts`, ключи внутри `ann`.

- [ ] **Step 1: Write the failing tests** — `schema.test.ts`:
  - `newBoard('Бросок', now)` проходит `BoardSchema.parse`, `frameCount === 1`, `items.length === 0`.
  - круг `boardToFile` → `parseBoardText` возвращает равную доску.
  - `figure` с `set:'player', pose:'dive-low'` → ошибка схемы.
  - `show.to = 3` при `frameCount = 3` → ошибка.
  - `states` с кадрами `[2, 2]` → ошибка; `frame === show.from` → ошибка.
  - `version: 2` → `{ok:false, error:'newer'}`; `'{'` → `'json'`; `format:'other'` → `'format'`.
  - `shape` с `ann.type:'loupe'` → ошибка; `ann` с полем `timing` — поле отбрасывается или ошибка (выбрать strict-отказ: ошибка).
- [ ] **Step 2:** `npx vitest run src/shared/board/schema.test.ts` → FAIL (модуля нет).
- [ ] **Step 3:** Реализовать `ids.ts`, `schema.ts` по Interfaces.
- [ ] **Step 4:** тот же запуск → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add src/shared/board docs/superpowers` ; `git commit -m "Доска: схема файла .flowboard"` (вместе со спецификацией и этим планом).

---

### Task 2: Состояние в кадре и сцена во времени

**Files:**
- Create: `src/shared/board/resolve.ts`
- Test: `src/shared/board/resolve.test.ts`

**Interfaces:**
- Consumes: Task 1 типы, `GEOM_KEYS`, `smoothstep` из `src/shared/animation.ts`.
- Produces:
  - `LEAD_IN = 0.5`, `HOLD_END = 1.0` (секунды видео до первого перехода и после последнего).
  - `boardDuration(b: Board): number` = `LEAD_IN + (frameCount-1)*transition + HOLD_END`.
  - `frameStart(b: Board, frame: number): number` = `LEAD_IN + frame*transition`.
  - `elementAt(item: BoardItem, frame: number): BoardElement` — базовый `el` + все `states` с `frame ≤ f` по порядку (geom-поля сливаются, `pose`/`facing` заменяют).
  - `visibleAt(item, frame): boolean` = `show.from ≤ frame ≤ show.to`.
  - `interface ResolvedItem { id: string; el: BoardElement; opacity: number }`.
  - `sceneAt(b: Board, t: number): ResolvedItem[]` — по порядку `items` (порядок = слои). `t` до `LEAD_IN` → кадр 0; после последнего перехода → последний кадр. Внутри перехода `f → f+1`, `u = smoothstep(доля)`: числа и точки (`{x,y}` и массивы точек одинаковой длины) — линейно по `u`; `rotation` — по кратчайшей дуге; `pose`/`facing` — из `f` при `u < 0.5`, иначе из `f+1`; `opacity` = `lerp(visible(f)?1:0, visible(f+1)?1:0, u)`; элементы с `opacity === 0` не возвращаются.
  - `sceneAtFrame(b, frame): ResolvedItem[]` — то же для неподвижного кадра (для редактора и PNG).

- [ ] **Step 1: Write the failing tests:**
  - фигура в кадре 0 `pos {0.2,0.5}`, состояние кадра 2 `pos {0.6,0.5}` → `elementAt(…,1).pos.x === 0.2`, `elementAt(…,2).pos.x === 0.6`.
  - `transition = 1`: `sceneAt(b, LEAD_IN + 1.5)` между кадрами 1 и 2 → `pos.x` строго между 0.2 и 0.6, равно `0.2 + 0.4*smoothstep(0.5)`.
  - поза `set` в кадре 0, `dive-low` в кадре 1: при доле 0.4 — `set`, при 0.6 — `dive-low`.
  - мяч `show {from:2,to:2}`: в `sceneAtFrame(b,1)` нет; в середине перехода 1→2 `opacity === 0.5`; в кадре 3 нет.
  - `rotation` 170 → −170: в середине = ±180 (не 0).
  - `boardDuration` при 3 кадрах и `transition 1` = 3.5.
  - `t < 0` и `t > boardDuration` не бросают, дают кадр 0 / последний.
- [ ] **Step 2:** `npx vitest run src/shared/board/resolve.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `Доска: состояние элементов по кадрам и во времени`.

---

### Task 3: Чистые операции правки

**Files:**
- Create: `src/shared/board/edit.ts`
- Test: `src/shared/board/edit.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2 (`elementAt`).
- Produces (все возвращают новую `Board`, вход не меняют; ошибки входа — `throw`):
  - `addItem(b, el: BoardElement, frame: number, id: string): Board` — `show {from: frame, to: frameCount-1}`, в конец (верхний слой).
  - `editGeom(b, id, frame, geom: Record<string, unknown>): Board` — `frame === show.from` → меняется `el`; иначе upsert состояния кадра `frame` (только переданные поля).
  - `setPose(b, id, frame, pose)`, `setFacing(b, id, frame, facing)` — так же (база или состояние).
  - `setStyle(b, id, patch)` — цвет/толщина/подпись/номер/масштаб текста: **не** анимируется, меняет `el` и не трогает состояния.
  - `setShow(b, id, from, to)` — состояния с `frame ≤ from` сливаются в базу (как `elementAt(from)`), остальные сохраняются.
  - `hideFrom(b, id, frame)` = `setShow(from, frame-1)`; при `frame ≤ show.from` — удаляет элемент.
  - `deleteItem(b, id)`, `bringToFront(b, id)`, `sendToBack(b, id)`.
  - `addFrame(b, after: number): Board` — вставляет кадр после `after` (копия состояния `after`): у всех `show`/`states` с кадром `> after` номер +1; элементы, у которых `show.to === after` и это был последний кадр доски, **продолжаются** на новый кадр (`to + 1`), остальные `to ≥ after` тоже +1 только если `to > after`. Ошибка при `frameCount === MAX_FRAMES`.
  - `removeFrame(b, frame): Board` — номера `> frame` −1; состояния кадра `frame` сливаются в следующий кадр (чтобы позиция на следующем кадре не менялась); элемент, видимый только в этом кадре, удаляется; `frameCount === 1` → ошибка.
  - `setTransition(b, sec)`, `setView(b, view)`, `setTitle(b, title)`.

- [ ] **Step 1: Write the failing tests** (по одному на операцию), плюс из Review Focus:
  - `removeFrame` кадра 1 из 3, где у фигуры состояние в кадре 1 (`x 0.5`) и в кадре 2 нет: после удаления `elementAt(…,1).pos.x === 0.5` (бывший кадр 2 не сдвинулся).
  - `removeFrame` кадра, в котором мяч `show {1,1}` → мяча нет.
  - `removeFrame` кадра 0, когда фигура `show.from = 0` и есть состояние кадра 1 → база = бывший кадр 1, `show.from = 0`.
  - `addFrame(after: 0)` при 2 кадрах: стрелка `show {0,0}` остаётся `{0,0}`, фигура `show {0,1}` → `{0,2}`, состояние кадра 1 → кадр 2.
  - `editGeom` в кадре `show.from` не создаёт состояний.
  - `setStyle` цвета в кадре 2 меняет цвет во всех кадрах.
  - любая операция результата проходит `BoardSchema.parse`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Доска: операции правки и кадров`.

---

### Task 4: Фоны видов поля

**Files:**
- Create: `src/renderer/src/features/board/art/pitchViews.tsx`, `src/renderer/src/features/board/art/constants.ts`
- Test: `src/renderer/src/features/board/art/pitchViews.test.tsx`

**Interfaces:**
- Produces:
  - `constants.ts`: `BOARD_W = 1600`, `BOARD_H = 900` (логические единицы SVG; координаты элементов 0..1 умножаются на них).
  - `interface PitchView { id: PitchViewId; label: string; Background: () => React.JSX.Element; scaleAt(y: number): number }` — `scaleAt` = масштаб фигуры по умолчанию при постановке на высоте `y` (перспектива; для `full-top` константа 0.45).
  - `PITCH_VIEWS: readonly PitchView[]` в порядке `PITCH_VIEW_IDS`; `pitchView(id): PitchView`.
  - Виды: `box-front` — из-за линии штрафной лицом к воротам (как одобренный набросок: ворота с сеткой вверху по центру, трапеция штрафной, полосы газона, горизонт); `half-angle` — половина поля сверху-сбоку под углом (видна штрафная, вратарская, дуга, центральная линия внизу); `full-top` — всё поле сверху (точные пропорции 105×68, вся разметка).
  - Подписи: «Штрафная спереди», «Половина поля», «Всё поле сверху».

- [ ] **Step 1: Write the failing test:** для каждого id `renderToStaticMarkup(<svg viewBox="0 0 1600 900"><Background/></svg>)` содержит `<path` или `<rect`, длина > 500; `PITCH_VIEWS.map(v=>v.id)` равно `PITCH_VIEW_IDS`; `scaleAt` монотонно растёт с `y` для `box-front` и `half-angle`.
- [ ] **Step 2:** FAIL. **Step 3:** нарисовать. **Step 4:** PASS.
- [ ] **Step 5:** Снимок: временный скрипт или e2e-снимок позже (Task 13); сейчас открыть разметку в браузере через `renderToStaticMarkup` в файл в scratchpad — по желанию. **Commit** `Доска: рисованные виды поля`.

---

### Task 5: Фигуры (вратари, игроки, тренеры) с 8 направлениями

**Files:**
- Create: `src/renderer/src/features/board/art/figures/kit.ts`, `figures/gk.tsx`, `figures/player.tsx`, `figures/coach.tsx`, `art/figureArt.tsx`
- Test: `src/renderer/src/features/board/art/figureArt.test.tsx`

**Interfaces:**
- Consumes: `FIGURE_POSES`, `FACINGS` (Task 1).
- Produces:
  - `kit.ts`: `interface Kit { shirt: string; shirtShade: string; shirtLight: string; shorts: string; socks: string; gloves?: string }`; `kitFor(set: FigureSet, color: string): Kit` (тени — затемнение/осветление `color`; вратарь: шорты тёмные, гетры цвета формы, перчатки белые; игрок: шорты белые, гетры цвета формы; тренер: тёмные брюки, без гетр). `DEFAULT_COLOR: Record<FigureSet,string> = { gk: '#f5c400', player: '#d9342b', coach: '#2a62d9' }`.
  - Рисунки: единицы — ступни в (0,0), рост стоящей фигуры ≈ 200 вверх (y отрицательный). Каждая поза — компонент `(props:{kit: Kit}) => JSX` на каждое **нарисованное** направление.
  - `DRAWN_FACINGS = ['front','front-right','right','back-right','back']`. Позы, где сторона почти не важна (`dive-low`, `dive-high`, `smother`), можно рисовать только `front`, `right`, `back` — тогда `front-right`→`front`, `back-right`→`back` (таблица замен в файле позы).
  - `figureArt.tsx`: `FigureArt({ set, pose, facing, color }): JSX.Element` — берёт рисунок для направления; для `*-left` рисует `*-right` с `transform="scale(-1 1)"`; неизвестная поза → `set`/`stand`/`stand-ball` (не падать). `FIGURE_ART_HEIGHT = 200`. `poseLabel(set, pose): string` — подписи: стойка, шаг, низкий бросок, высокий бросок, высокий мяч, выход в ноги; стоит, бег; с мячом, бросок рукой.
  - Со спины: затылок, номер на футболке («1» у вратаря, «9» у игрока; у тренера без номера), тыльная сторона перчаток тёмная.

- [ ] **Step 1: Write the failing tests:** для каждого `set` × `FIGURE_POSES[set]` × `FACINGS` разметка `FigureArt` не пустая; для `left` разметка содержит `scale(-1 1)`, для `right` — нет; `front` и `back` различаются; неизвестная поза не бросает; `kitFor('gk','#f5c400').shirtShade` темнее `shirt`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Нарисовать. Начать с `gk/set` во всех 5 направлениях (образец `angles.html`), затем остальные позы. Пропорции и манера — как в `figures-v2.html`, аккуратнее наброска.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Снимок всех поз (лист) — `renderToStaticMarkup` в HTML в scratchpad, открыть в браузере, показать пользователю ПЕРЕД коммитом: это главное, что он оценит. Поправить по замечаниям. **Commit** `Доска: фигуры вратарей, игроков, тренеров (8 направлений)`.

---

### Task 6: Инвентарь и отрисовка любого элемента

**Files:**
- Create: `src/renderer/src/features/board/art/equipment.tsx`, `src/renderer/src/features/board/BoardItemView.tsx`
- Test: `src/renderer/src/features/board/BoardItemView.test.tsx`

**Interfaces:**
- Consumes: Task 1 (типы, `GEOM_KEYS`), Task 4 (`BOARD_W/H`), Task 5 (`FigureArt`, `FIGURE_ART_HEIGHT`), `ShapeView` (`src/renderer/src/features/annotations/ShapeView.tsx`).
- Produces:
  - `equipment.tsx`: `EquipmentArt({ item, color })`, `EQUIPMENT_LABEL: Record<EquipmentId,string>` (мяч, фишка, конус, манекен, мини-ворота), `DEFAULT_EQUIP_COLOR` (фишка/конус — `#ff7a00`, манекен — `#e8e8e8`, мини-ворота — `#ffffff`, мяч — `#ffffff`). Единицы как у фигур (низ в 0,0); рост: мяч 22, фишка 14, конус 40, манекен 180, мини-ворота 90.
  - `FIGURE_BASE_H = 0.3` — рост фигуры при `scale 1` как доля `BOARD_H`.
  - `BoardItemView({ item: ResolvedItem, selected: boolean }): JSX.Element` — `<g data-board-item={id} data-kind={kind} opacity>` (у фигур ещё `data-pose`, `data-facing` — для e2e):
    - `figure`/`equip`: `translate(pos.x*BOARD_W, pos.y*BOARD_H) rotate(rotation) scale(scale * FIGURE_BASE_H * BOARD_H / FIGURE_ART_HEIGHT)`.
    - `token`: кружок радиус `0.022*BOARD_H*scale`, белая обводка, `label` по центру жирным; `number`: белый кружок с тёмной обводкой и цифрой цвета `color`.
    - `wavy`: синусоида от `p1` к `p2` (шаг 0.025 высоты, амплитуда 0.008) + наконечник.
    - `hatch`: фигура с заливкой `<pattern>` штриховки (45°, цвет `color`, прозрачность 0.35) и обводкой.
    - `shape`: `ShapeView` с `annotation = {...ann, timing:{mode:'range', start:0, duration: 60}}`, `size {w: BOARD_W, h: BOARD_H}`, `showHandles:false`.
    - `selected` — пунктирная рамка вокруг (`data-selected="true"`).
  - `itemBox(item: ResolvedItem): {x:number,y:number,w:number,h:number}` — рамка элемента в долях 0..1 (для попадания мышью и ручек).

- [ ] **Step 1: Write the failing tests:** у каждого вида элемента разметка содержит `data-kind="<kind>"`; `figure` с `scale 2` даёт `scale(` вдвое больше, чем с `scale 1`; `shape` со стрелкой содержит разметку `ShapeView` (атрибут, который `ShapeView` ставит на корень — посмотреть в файле); `itemBox` фигуры: низ рамки ≈ `pos.y`; `hatch` содержит `<pattern`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Доска: инвентарь и отрисовка элементов`.

---

### Task 7: Сцена и экспорт кадров в PNG

**Files:**
- Create: `src/renderer/src/features/board/BoardScene.tsx`, `src/renderer/src/features/board/boardRender.ts`
- Test: `src/renderer/src/features/board/boardRender.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`sceneAt`, `sceneAtFrame`, `boardDuration`), Task 4, Task 6; `rasterizeSvg` из `src/renderer/src/features/export/renderOverlays.tsx`.
- Produces:
  - `BoardScene({ board, frame?: number, time?: number, selectedIds?: readonly string[] })` — `<svg viewBox="0 0 1600 900" data-board-scene data-frame|data-time>`: фон вида + элементы; `time` задан → `sceneAt`, иначе `sceneAtFrame(frame ?? 0)`.
  - `EXPORT_W = 1920`, `EXPORT_H = 1080`, `VIDEO_FPS = 30`.
  - `buildBoardSvg(board, at: {frame:number}|{time:number}, w = EXPORT_W, h = EXPORT_H): string` — `renderToStaticMarkup` с `width/height` и `xmlns`.
  - `renderBoardPng(board, frame, canvas?): Promise<Uint8Array>` — через `rasterizeSvg` + `toBlob('image/png')`.
  - `async function* renderBoardVideoFrames(board, signal?: AbortSignal): AsyncGenerator<{index:number; png:Uint8Array}>` — кадры на `i / VIDEO_FPS`, `i < ceil(boardDuration*VIDEO_FPS)`; одинаковые подряд кадры (до первого перехода, в паузе в конце) рендерить один раз и отдавать повтором (кэш по строке SVG).
  - `renderBoardThumb(board): Promise<string>` — JPEG 320×180, `data:` URL, ≤ 80 000 символов (снижать качество до укладывания).

- [ ] **Step 1: Write the failing tests** (без canvas — только SVG): `buildBoardSvg` содержит `width="1920"` и `data-board-scene`; доска с мячом `show {1,1}` — в кадре 0 нет `data-kind="equip"`, в кадре 1 есть; число кадров генератора для 2 кадров и `transition 1` = `ceil(2.5*30) = 75` (подменить растеризацию заглушкой через параметр `rasterize?: (svg)=>Promise<Uint8Array>`), и заглушка вызвана меньше 75 раз (кэш).
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Доска: сцена и кадры для экспорта`.

---

### Task 8: Файлы досок в main и IPC (сохранить, открыть, список, картинка)

**Files:**
- Create: `src/main/board/files.ts`, `src/main/ipc/board.ts`, `src/shared/board/ipc.ts`, `src/shared/board/fileName.ts`
- Modify: `src/shared/ipc-contract.ts` (каналы + методы `FlowApi`), `src/preload/index.ts`, `src/main/ipc/register.ts`
- Test: `src/main/board/files.test.ts`, `src/main/ipc/board.test.ts`

**Interfaces:**
- Consumes: Task 1 (`BoardSchema`, `parseBoardText`, `boardToFile`), `writeTextAtomic` (`src/main/project/files.ts`), `resolveProjectsFolder` (`src/main/library/folder.ts`), `shell.trashItem`, `dialog.showSaveDialog`.
- Produces:
  - Папка досок: `<папка проектов>/Доски` (создаётся при первом сохранении).
  - `src/shared/board/fileName.ts` (общий для main и renderer): `safeFileName(title: string): string` (убирает `/ \ : * ? " < > |` и управляющие, схлопывает пробелы, обрезает до 80, пустое → «Доска»).
  - `files.ts`: `boardsFolder(projectsFolder: string): string`; `uniquePath(folder, base, ext): Promise<string>` (« (2)», « (3)»…); `readBoardFile(path): Promise<{ok:true, board} | {ok:false, error, message}>`; `writeBoardFile(path, board): Promise<void>`; `listBoards(folder): Promise<BoardCard[]>`.
  - `src/shared/board/ipc.ts`: `interface BoardCard { path: string; title: string; updatedAt: string | null; frames: number; thumb: string | null; status: 'ok'|'error'; error?: string }`; `BoardSaveRequestSchema = { path: string | null, board: BoardSchema }`; `BoardSaveResult = { path: string }`; `BoardOpenResult = {ok:true, path, board} | {ok:false, message}`; `SaveImageRequestSchema = { suggestedName: string, png: Uint8Array (≤ 20 МБ) }`.
  - IPC (`IPC_CHANNELS`): `boardList: 'board:list'`, `boardSave: 'board:save'`, `boardOpen: 'board:open'`, `boardDelete: 'board:delete'`, `boardSaveImage: 'board:save-image'`, `boardExportVideo: 'board:export-video'`, `boardStageFrames: 'board:stage-frames'`, `boardFinishVideo: 'board:finish-video'`, `boardCancelVideo: 'board:cancel-video'`, `boardReveal: 'board:reveal'`; событие `boardVideoProgress: 'board:video-progress'`.
  - `FlowApi`: `listBoards(): Promise<BoardCard[]>`; `saveBoard(req): Promise<BoardSaveResult>` (path null → новый файл в папке досок по `safeFileName(title)` + `uniquePath`); `openBoard(path): Promise<BoardOpenResult>` (только пути внутри папки досок или ранее выданные); `deleteBoard(path): Promise<void>` (в Корзину); `revealBoard(path): Promise<void>` (показать в проводнике); `saveBoardImage(req): Promise<{path: string} | null>` (диалог сохранения PNG, null — отмена). Видео-методы — Task 9.

- [ ] **Step 1: Write the failing tests:** `safeFileName('Бросок: 1/2?')` → `'Бросок 12'` (или без двойных пробелов — зафиксировать точное значение в тесте); `uniquePath` при занятом имени даёт « (2)»; `writeBoardFile`→`readBoardFile` круг; повреждённый файл → `{ok:false}` и `listBoards` даёт карточку `status:'error'`, не бросает; `openBoard` с путём вне папки досок → отказ; `saveBoard` с невалидной доской → reject (zod).
- [ ] **Step 2:** FAIL. **Step 3:** реализовать (обработчики проверяют вход zod, как `src/main/ipc/project.ts`). **Step 4:** PASS + `npm run typecheck`.
- [ ] **Step 5: Commit** `Доска: файлы .flowboard и IPC`.

---

### Task 9: MP4 из кадров доски

**Files:**
- Create: `src/main/board/video.ts`
- Modify: `src/main/ipc/board.ts`, `src/shared/board/ipc.ts`, `src/shared/ipc-contract.ts`, `src/preload/index.ts`
- Test: `src/main/board/video.test.ts`

**Interfaces:**
- Consumes: `runFfmpeg` (`src/main/ffmpeg/runner.ts`), `CPU_ENCODER` (`src/main/ffmpeg/encoders.ts`), путь ffmpeg — как его берёт `src/main/ffmpeg/job.ts`; временная папка — `os.tmpdir()` с префиксом `flow-board-`.
- Produces:
  - `boardVideoArgs(framesDir: string, fps: number, out: string): string[]` = `['-y','-framerate',String(fps),'-i', join(framesDir,'%05d.png'), ...CPU_ENCODER.videoArgs, '-movflags','+faststart', out]`.
  - IPC: `exportBoardVideo({ suggestedName, frameCount, fps }): Promise<{path:string} | null>` — сначала диалог сохранения MP4 (отмена → null, без работы), затем выдаёт `token`; `stageBoardFrames({ token, start: number, pngs: Uint8Array[] }) : Promise<void>` — пишет `%05d.png` (проверка: PNG-сигнатура, ≤ 20 МБ каждый, индексы подряд, не больше `frameCount`); `finishBoardVideo(token): Promise<{path}>` — запускает ffmpeg, прогресс событием `boardVideoProgress {token, done, total}`; `cancelBoardVideo(token)`. Временная папка удаляется в любом исходе.
  - Повторы одинаковых кадров передаются как отдельные файлы (просто, ffmpeg не меняем).

- [ ] **Step 1: Write the failing tests:** `boardVideoArgs` содержит `-framerate 30`, `%05d.png`, `libx264`, `yuv420p`, выход последним; стадия отвергает не-PNG и пропуск индекса; отмена удаляет папку; (как в `src/main/ffmpeg/*.test.ts` — если там есть набор для реального ffmpeg `ffmpeg.testkit.ts`, добавить один тест: 3 одинаковых PNG → MP4 существует, длительность ≈ 0.1 с).
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Доска: сохранение видео MP4`.

---

### Task 10: Состояние редактора и история

**Files:**
- Create: `src/renderer/src/features/board/boardStore.ts`
- Test: `src/renderer/src/features/board/boardStore.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `type BoardSection = 'equipment'|'gk'|'player'|'coach'|'tokens'|'arrows'|'pencil'|'text'|'numbers'|'zones'`.
  - `type BoardTool = {kind:'select'} | {kind:'place', el: BoardElement} | {kind:'draw', draw: 'arrow'|'line'|'curve'|'arrow-dashed'|'wavy'|'pen'|'pen-dashed'|'text'|'hatch-rect'|'hatch-tri'|'hatch-ellipse'}`.
  - `useBoardStore` (zustand): `board: Board | null`, `path: string | null`, `dirty: boolean`, `frame: number`, `section: BoardSection`, `tool: BoardTool`, `selection: string[]`, `playing: boolean`, `past/future: Snapshot[]` (`Snapshot = {board, frame, selection}`, глубина 100).
  - Действия: `load(board, path)`, `reset()`, `apply(fn: (b: Board) => Board)` (снимок в `past`, чистит `future`, `dirty = true`; ошибка операции — не меняет ничего и возвращает текст ошибки), `undo()`, `redo()`, `setFrame(n)` (не в историю), `setSection`, `setTool`, `select(ids)`, `markSaved(path)`.
  - При `setSection('gk')` и т. п. инструмент — `place` с первой позой раздела.

- [ ] **Step 1: Write the failing tests:** `apply(addFrame)` + `setFrame(1)` → `undo()` возвращает `frameCount 1` и `frame 0` (Review Focus); `undo` после `apply` возвращает предыдущую доску, `redo` — снова; `dirty` после `apply` true, после `markSaved` false; `apply` с бросающей операцией не меняет `past`; 101-я операция выталкивает первую.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Доска: состояние редактора и отмена`.

---

### Task 11: Экран редактора (раскладка A) и работа мышью

**Files:**
- Create: `BoardEditor.tsx`, `BoardCanvas.tsx`, `BoardRail.tsx`, `BoardTray.tsx`, `BoardFrames.tsx`, `BoardViews.tsx`, `boardActions.ts`, `board.css` в `src/renderer/src/features/board/`
- Modify: `src/renderer/src/app/viewStore.ts` (`AppView = 'start' | 'workspace' | 'board'`), `src/renderer/src/app/App.tsx` (ветка `view === 'board'` → `<ErrorBoundary area="board"><BoardEditor/></ErrorBoundary>`), `src/renderer/src/i18n/ru.ts` (раздел `board`), `src/renderer/src/features/commands/definitions.ts` (+ группа «Доска» в `keymap.ts`)
- Test: `src/renderer/src/features/board/canvasMath.test.ts` (+ `canvasMath.ts`), e2e — Task 13

**Interfaces:**
- Consumes: Task 4–10; `TextEditor.tsx` из annotations (поле ввода текста), `src/shared/tools/simplify` (перо).
- Produces:
  - Раскладка (как утверждённый макет A, `.superpowers/brainstorm/342-1792741045/content/layout.html`): верхняя панель «← Главная», название (правится по щелчку), отменить/повторить, «Сохранить», «Сохранить видео» (выключена при `frameCount < 2`), «Сохранить картинку»; ряд миниатюр видов; слева разделы `BoardSection` (Инвентарь, Вратари, Игроки, Тренеры, Кружки, Стрелки, Карандаш, Текст, Номера, Зоны); поле (вписано с сохранением 16:9); под полем ряд элементов раздела (`BoardTray`: у фигур — позы, у инвентаря — предметы, у стрелок — 5 видов, у карандаша — 2, у зон — 3 и «линия»; в начале ряда — кисть цвета: палитра 10 цветов + свой); полоса кадров (`BoardFrames`: ▶/⏸, кадры 1…N, «+», правый щелчок по кадру — «Удалить кадр», длительность перехода 0.3–5 с); приближение/перемещение поля и «во весь экран» — как у них.
  - `canvasMath.ts`: `clientToBoard(rect: DOMRect, clientX, clientY): Point` (с учётом вписывания), `hitTest(items: ResolvedItem[], p: Point): string | null` (сверху вниз по `itemBox`).
  - Мышь (`BoardCanvas`):
    - `place`: щелчок ставит элемент в текущий кадр (масштаб фигуры/инвентаря — `pitchView(view).scaleAt(y)`), инструмент остаётся (можно ставить ещё).
    - `select`: щелчок выделяет, Shift — добавляет; перетаскивание двигает (`editGeom` в текущем кадре); ручки: угол — масштаб, кружок сверху — поворот; Delete — `deleteItem`.
    - Выделенная фигура: панель над полем — «Сторона» (8 стрелок по кругу), «Поза» (список поз набора), «Цвет», «Спрятать с этого кадра» (`hideFrom`), «Показать с этого кадра» (`setShow(frame, …)`), «Наверх/Вниз».
    - `draw`: стрелка/линия/пунктир/волнистая — тянуть от p1 к p2; изогнутая — тянуть, затем ручка изгиба; перо — вести; текст — щелчок → поле ввода; зоны — тянуть рамку.
    - Пока идёт воспроизведение — правка выключена.
  - Команды (настраиваемые, группа «Доска»): `board:undo` Ctrl+Z, `board:redo` Ctrl+Y, `board:delete` Delete, `board:play` Space, `board:prev-frame` ←, `board:next-frame` →, `board:add-frame` `+`, `board:save` Ctrl+S, `board:save-image` Ctrl+Shift+S, `board:select` V. Активны только при `view === 'board'`; команды видео при этом не срабатывают (проверить `dispatcher.ts`, как он узнаёт текущий экран).
  - `boardActions.ts`: `saveBoard(saveAs?)` (обновляет `thumb` через `renderBoardThumb`), `saveImage()` (имя — `safeFileName(title)` из `src/shared/board/fileName.ts` + номер кадра, если кадров > 1), `saveVideo()` (кадры генератора порциями по 30 в `stageBoardFrames`, прогресс в строке состояния, «Отмена»), `goHome()` (Task 12 добавит вопрос о сохранении).

- [ ] **Step 1: Write the failing tests** `canvasMath.test.ts`: `clientToBoard` при поле 800×450 в окне 1000×450 (поля по 100 слева/справа) — щелчок в (100, 0) → (0,0), (900,450) → (1,1); `hitTest` выбирает верхний из двух пересекающихся.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать `canvasMath.ts`, затем компоненты. **Step 4:** PASS; `npm run lint`, `npm run typecheck`.
- [ ] **Step 5:** `npm run dev` (через `env -u ELECTRON_RUN_AS_NODE`), открыть доску (временно — через `useViewStore.getState().setView('board')` из `testHooks.ts`, кнопка появится в Task 12), поставить вратаря, повернуть, добавить кадр, сдвинуть, проиграть. Снимок экрана пользователю. **Commit** `Доска: экран редактора`.

---

### Task 12: Начальный экран: «Новая доска», карточки досок, вопрос о сохранении

**Files:**
- Modify: `src/renderer/src/features/library/StartScreen.tsx`, `src/renderer/src/features/project/useProjectLifecycle.ts` (закрытие окна учитывает `useBoardStore.dirty`), `src/renderer/src/features/board/boardActions.ts`, `src/renderer/src/i18n/ru.ts`
- Create: `src/renderer/src/features/board/BoardCards.tsx`

**Interfaces:**
- Consumes: Task 8 (`listBoards`, `openBoard`, `deleteBoard`), Task 10, Task 11.
- Produces:
  - Кнопка «Новая доска» рядом с «Новый проект» → `newBoard('Новая доска', now)` в store, `setView('board')`.
  - Раздел «Доски» под проектами: карточки (обложка `thumb`, название, «N кадров», дата), щелчок — открыть, меню — «Показать в папке», «Удалить» (в Корзину, с подтверждением как у проектов). Карточка с ошибкой — пометка и только «Удалить»/«Показать в папке».
  - `goHome()` и закрытие окна при `dirty` — тот же вопрос «Сохранить изменения?» (Сохранить / Не сохранять / Отмена), что у проектов (найти и переиспользовать диалог из `features/project`).
  - Заголовок окна: `setWindowTitle(title, dirty)`.

- [ ] **Step 1:** Реализовать (поведение проверяется e2e Task 13).
- [ ] **Step 2:** `npm run lint`, `npm run typecheck`, `npm test` — PASS.
- [ ] **Step 3: Commit** `Доска: начальный экран и сохранение`.

---

### Task 13: E2E доски

**Files:**
- Create: `tests/e2e/board.spec.ts`, `tests/e2e/boardHelpers.ts`

**Interfaces:**
- Consumes: `launch`, `makeUserData`, `stubSaveDialog`, `saveDialogCalls`, `SHOTS`, `SUFFIX` из `tests/e2e/helpers.ts`; `FLOW_LIBRARY_DIR`.

- [ ] **Step 1: Write the tests:**
  - «Новая доска → вратарь → сторона → сохранить → открыть снова»: на начальном экране «Новая доска»; раздел «Вратари», щелчок по позе «Стойка», щелчок по полю → `[data-kind="figure"]` один; выбрать сторону «Спиной» → у фигуры `data-facing="back"` (добавить атрибут в `BoardItemView`); Ctrl+S → файл `Доски/Новая доска.flowboard` есть; «← Главная» → карточка «Новая доска»; открыть → фигура на месте, `data-facing="back"`.
  - «Анимация»: «+» → кадр 2; сдвинуть фигуру мышью; сменить позу на «Низкий бросок»; ▶ — через ~`LEAD_IN + transition/2` у сцены `data-time` в середине (атрибут на `BoardScene` в режиме воспроизведения); в кадре 1 поза «стойка», в кадре 2 — «низкий бросок».
  - «Появление»: мяч, поставленный в кадре 2, в кадре 1 не виден.
  - «Сохранить картинку»: заглушка диалога → PNG существует, первые 8 байт — сигнатура PNG, размер 1920×1080 (прочитать IHDR).
  - «Сохранить видео»: 2 кадра, заглушка диалога → MP4 существует, > 10 КБ.
  - «Несохранённая доска»: правка → «← Главная» → вопрос о сохранении появился; «Отмена» — остаёмся на доске.
  - «Повреждённый файл»: положить `Доски/Битая.flowboard` с `{` → карточка с пометкой ошибки, программа работает.
  - Снимок экрана редактора с вратарём и стрелкой → `SHOTS/board-editor${SUFFIX}.png`.
- [ ] **Step 2:** `npm run test:e2e -- board.spec.ts` → PASS (до этого — убедиться, что e2e «Связки» в другом каталоге не идут).
- [ ] **Step 3:** Весь набор: `npm test`, `npm run test:e2e` — PASS (старые тесты не сломаны).
- [ ] **Step 4: Commit** `Доска: автотесты`.

---

### Task 14: Доводка этапа

**Files:**
- Modify: `README.md` (раздел «Доска»), `package.json` (`version` → `0.19.0` — только при вливании в `main`, согласовать с порядком «Связки»)

- [ ] **Step 1:** README: что умеет доска, где лежат файлы (`Документы\FlowAnalyzer\Доски`), что будет на этапе 2.
- [ ] **Step 2:** Финальная проверка: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build:win` (сборка проходит). Снимки экрана и сохранённую PNG показать пользователю (`C:\Users\user\Pictures\FlowAnalyzer-доска` + SendUserFile).
- [ ] **Step 3: Commit** `Доска: этап 1 готов`. Вливание в `main` — после «Связки», с решением конфликтов в `ru.ts`, `definitions.ts`, `ipc-contract.ts`, `preload`, `App.tsx`; решение — за пользователем.
