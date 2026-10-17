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
  toolRail: { label: 'Инструменты' },
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
