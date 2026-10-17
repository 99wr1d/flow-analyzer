// Все строки интерфейса в одном месте.
export const ru = {
  appName: 'FlowAnalyzer',
  topBar: {
    projectLabel: 'Проект',
    newProject: 'Новый проект',
    openVideo: 'Открыть видео',
    openVideoTitle: 'Открыть видеофайл (Ctrl+O)',
    fileLabel: 'Видео'
  },
  toolRail: {
    label: 'Инструменты',
    select: 'Выбор (V)',
    arrow: 'Стрелка (A)',
    line: 'Линия (L)',
    circle: 'Круг (C)',
    text: 'Текст (T)'
  },
  annotations: {
    styleBar: 'Стиль рисунка',
    color: 'Цвет',
    width: 'Толщина',
    dash: 'Тип линии',
    solid: 'Сплошная',
    dashed: 'Пунктирная',
    textBackground: 'Фон под текстом',
    undo: 'Отменить (Ctrl+Z)',
    redo: 'Повторить (Ctrl+Y)',
    textInput: 'Текст на видео',
    textPlaceholder: 'Текст…',
    types: { arrow: 'Стрелка', line: 'Линия', circle: 'Круг', text: 'Текст' } as Record<
      string,
      string
    >,
    trackLabel: 'Рисунки',
    trackEmpty: 'Рисунков пока нет',
    trackItem: 'Выбрать рисунок и перейти к его началу',
    inspector: 'Рисунок',
    inspectorHint: 'Выберите рисунок на видео или на дорожке «Рисунки»',
    timing: 'Время показа',
    modeRange: 'Отрезок',
    modeFrame: 'Только кадр',
    modeRangeHint: 'Рисунок виден заданное число секунд',
    modeFrameHint: 'Рисунок виден только на одном кадре',
    duration: 'Длительность, с',
    durationErrors: {
      empty: 'Введите число секунд от 0.2 до 60',
      nan: 'Нужно число, например 2.5',
      range: 'Допустимо от 0.2 до 60 секунд'
    } as Record<string, string>,
    startsAt: 'Начало',
    startFromNow: 'Начать с текущего момента',
    remove: 'Удалить (Delete)'
  },
  stage: {
    label: 'Видео',
    emptyTitle: 'Видео не загружено',
    emptyHint: 'Перетащите видео сюда или нажмите «Открыть видео»',
    formats: 'MP4 (H.264), WebM, MOV',
    dropHere: 'Отпустите файл, чтобы открыть видео',
    playbackError:
      'Не удалось воспроизвести файл. Поддерживаются MP4 (H.264), WebM и MOV. Другие форматы научимся открывать позже.',
    dismiss: 'Закрыть сообщение',
    importFailed: 'Не удалось открыть файл'
  },
  episodes: {
    title: 'Эпизоды',
    empty: 'Меток пока нет'
  },
  transport: {
    label: 'Управление воспроизведением',
    play: 'Воспроизвести (Пробел)',
    pause: 'Пауза (Пробел)',
    playAria: 'Воспроизвести',
    pauseAria: 'Пауза',
    seek: 'Перемотка',
    seekTitle: 'Позиция в видео. Home и End — в начало и конец, PageUp и PageDown — на 10 секунд',
    speed: 'Скорость воспроизведения',
    speedTitle: 'Скорость: [ — медленнее, ] — быстрее',
    mute: 'Выключить звук (M)',
    unmute: 'Включить звук (M)',
    muteAria: 'Выключить звук',
    unmuteAria: 'Включить звук',
    volume: 'Громкость',
    volumeTitle: 'Громкость',
    frameBack: 'Кадр назад (←)',
    frameForward: 'Кадр вперёд (→)',
    frameBackAria: 'Кадр назад',
    frameForwardAria: 'Кадр вперёд',
    timeToggle:
      'Формат времени: нажмите, чтобы переключить между ММ:СС.д и таймкодом ЧЧ:ММ:СС:КК (кадры)',
    fpsLabel: 'Частота кадров',
    fpsUnit: 'к/с',
    fpsContainer: 'Частота кадров взята из файла.',
    fpsEstimated: 'Оценка по воспроизведению: в файле частота не указана.',
    fpsDefault:
      'По умолчанию — точная частота неизвестна. Запустите воспроизведение: приложение попробует определить её само.',
    fpsVariable:
      'Переменная частота кадров: показано среднее значение, покадровый переход приблизителен.',
    currentTime: 'Текущее время',
    totalTime: 'Длительность'
  },
  timeline: {
    label: 'Таймлайн',
    empty: 'Таймлайн появится после загрузки видео',
    noMarks: 'Меток пока нет',
    ruler: 'Шкала времени. Нажмите или потяните, чтобы перемотать'
  },
  status: {
    label: 'Строка состояния',
    loading: 'Загрузка…',
    error: 'Не удалось получить версию'
  },
  platforms: {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux'
  } as Record<string, string>
}
