// Все строки интерфейса в одном месте.
export const ru = {
  appName: 'FlowAnalyzer',
  topBar: {
    projectLabel: 'Проект',
    newProject: 'Новый проект'
  },
  toolRail: { label: 'Инструменты' },
  stage: {
    label: 'Видео',
    emptyTitle: 'Видео не загружено',
    emptyHint: 'Импорт видео появится на следующем этапе'
  },
  episodes: {
    title: 'Эпизоды',
    empty: 'Меток пока нет'
  },
  transport: { label: 'Управление воспроизведением' },
  timeline: {
    label: 'Таймлайн',
    empty: 'Таймлайн появится после загрузки видео'
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
