// Стартовый экран: библиотека проектов (карточки), поиск, вкладки по типам, «Новый проект», «Открыть файл».
import { useEffect, useMemo } from 'react'
import { PROJECT_TYPES } from '../../../../shared/project'
import { ImportBanner, SettingsWarning } from '../../app/NoticeBanners'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { FilmIcon, FolderOpenIcon, GearIcon, PlusIcon, SearchIcon, CloseIcon } from '../../ui/icons'
import { Logo } from '../../ui/Logo'
import { useKeyHint } from '../commands/useKeys'
import { openVideoFromDialog } from '../player/importVideo'
import { newProject, openProject } from '../project/actions'
import { ProjectBanners } from '../project/ProjectBanners'
import { useSettingsStore } from '../settings/settingsStore'
import { countByTab, visibleCards } from './cardsView'
import { dismissNotice, refreshLibrary } from './libraryActions'
import { useLibraryStore, type LibrarySort, type LibraryTab } from './libraryStore'
import { ProjectCard } from './ProjectCard'

const TAB_LABELS: Record<LibraryTab, string> = {
  all: ru.start.tabAll,
  match: ru.start.tabMatch,
  training: ru.start.tabTraining,
  scouting: ru.start.tabScouting,
  other: ru.start.tabOther
}
const TABS: LibraryTab[] = ['all', ...PROJECT_TYPES]

const SORT_LABELS: Record<LibrarySort, string> = {
  modified: ru.start.sortModified,
  title: ru.start.sortTitle,
  date: ru.start.sortDate
}

function Tabs(): React.JSX.Element {
  const tab = useLibraryStore((s) => s.tab)
  const cards = useLibraryStore((s) => s.cards)
  const counts = useMemo(() => countByTab(cards), [cards])
  return (
    <div className="lib-tabs" role="tablist" aria-label={ru.start.tabsLabel}>
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={tab === id ? 'lib-tab lib-tab--active' : 'lib-tab'}
          data-testid={`lib-tab-${id}`}
          onClick={() => useLibraryStore.setState({ tab: id })}
        >
          {TAB_LABELS[id]}
          <span className="lib-tab__count" data-testid={`lib-tab-${id}-count`}>
            {counts[id]}
          </span>
        </button>
      ))}
    </div>
  )
}

function Toolbar(): React.JSX.Element {
  const query = useLibraryStore((s) => s.query)
  const sort = useLibraryStore((s) => s.sort)
  return (
    <div className="lib-toolbar">
      <Tabs />
      <div className="lib-toolbar__spacer" />
      <label className="lib-search">
        <SearchIcon size={15} />
        <input
          type="text"
          className="lib-search__input"
          value={query}
          placeholder={ru.start.searchPlaceholder}
          aria-label={ru.start.searchLabel}
          data-testid="lib-search"
          onChange={(e) => useLibraryStore.setState({ query: e.target.value })}
        />
        {query !== '' && (
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label={ru.start.resetSearch}
            title={ru.start.resetSearch}
            data-testid="lib-search-clear"
            onClick={() => useLibraryStore.setState({ query: '' })}
          >
            <CloseIcon size={13} />
          </button>
        )}
      </label>
      <label className="lib-sort">
        <span className="lib-sort__label">{ru.start.sortLabel}</span>
        <select
          className="select"
          value={sort}
          data-testid="lib-sort"
          onChange={(e) => useLibraryStore.setState({ sort: e.target.value as LibrarySort })}
        >
          {(Object.keys(SORT_LABELS) as LibrarySort[]).map((id) => (
            <option key={id} value={id}>
              {SORT_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function Empty(): React.JSX.Element {
  return (
    <div className="lib-empty" data-testid="lib-empty">
      <div className="lib-empty__icon" aria-hidden="true">
        <FilmIcon size={44} />
      </div>
      <h2 className="lib-empty__title">{ru.start.emptyTitle}</h2>
      <p className="lib-empty__hint">{ru.start.emptyHint}</p>
      <button
        type="button"
        className="btn btn--primary"
        data-testid="lib-empty-new"
        onClick={() => void newProject()}
      >
        <PlusIcon size={16} />
        {ru.start.newProject}
      </button>
      <p className="lib-empty__hint lib-empty__hint--faint">{ru.start.emptyQuick}</p>
    </div>
  )
}

function Grid(): React.JSX.Element {
  const cards = useLibraryStore((s) => s.cards)
  const tab = useLibraryStore((s) => s.tab)
  const query = useLibraryStore((s) => s.query)
  const sort = useLibraryStore((s) => s.sort)
  const visible = useMemo(() => visibleCards(cards, tab, query, sort), [cards, tab, query, sort])
  // Время «N мин назад» считается один раз на загрузку списка.
  const now = useLibraryStore((s) => s.loadedAt)

  if (visible.length === 0) {
    return (
      <div className="lib-nomatch" data-testid="lib-nomatch">
        <h2 className="lib-empty__title">{ru.start.noMatchTitle}</h2>
        <p className="lib-empty__hint">{ru.start.noMatchHint}</p>
        {query !== '' && (
          <button
            type="button"
            className="btn"
            onClick={() => useLibraryStore.setState({ query: '', tab: 'all' })}
          >
            {ru.start.resetSearch}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="lib-grid" data-testid="lib-grid">
      {visible.map((card) => (
        <ProjectCard key={card.path} card={card} now={now} />
      ))}
    </div>
  )
}

function Notice(): React.JSX.Element | null {
  const notice = useLibraryStore((s) => s.notice)
  if (!notice) return null
  return (
    <div className="lib-notice" role="status" data-testid="lib-notice">
      <span>{notice}</span>
      <button
        type="button"
        className="icon-btn icon-btn--small"
        aria-label={ru.start.dismiss}
        title={ru.start.dismiss}
        onClick={dismissNotice}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

function Content(): React.JSX.Element {
  const loaded = useLibraryStore((s) => s.loaded)
  const error = useLibraryStore((s) => s.error)
  const total = useLibraryStore((s) => s.cards.length)
  if (!loaded) {
    return (
      <p className="lib-status" data-testid="lib-loading">
        {ru.start.loading}
      </p>
    )
  }
  if (error) {
    return (
      <div className="lib-nomatch" role="alert" data-testid="lib-error">
        <h2 className="lib-empty__title">{error}</h2>
        <button type="button" className="btn" onClick={() => void refreshLibrary()}>
          {ru.start.retry}
        </button>
      </div>
    )
  }
  if (total === 0) return <Empty />
  return (
    <>
      <Toolbar />
      <Grid />
    </>
  )
}

export function StartScreen(): React.JSX.Element {
  const openSettings = useSettingsStore((s) => s.openDialog)
  const settingsHint = useKeyHint('general:settings')
  const openVideoHint = useKeyHint('general:open-video')
  const newHint = useKeyHint('project:new')
  const folder = useLibraryStore((s) => s.folder)
  const dragActive = usePlayerStore((s) => s.dragActive)

  useEffect(() => {
    useLibraryStore.setState({ notice: null })
    void refreshLibrary()
  }, [])

  return (
    <main
      className={dragActive ? 'start start--drop' : 'start'}
      aria-label={ru.start.label}
      data-testid="start-screen"
    >
      <header className="start__bar">
        <div className="start__brand">
          <Logo size={26} />
          <span className="start__name">{ru.appName}</span>
        </div>
        <div className="top-bar__spacer" />
        <button
          type="button"
          className="btn"
          title={`${ru.start.quickOpenTitle}${openVideoHint}`}
          data-testid="open-video"
          onClick={(e) => {
            void openVideoFromDialog()
            e.currentTarget.blur()
          }}
        >
          <FilmIcon size={16} />
          {ru.start.quickOpen}
        </button>
        <button
          type="button"
          className="btn"
          title={ru.start.openFileTitle}
          data-testid="start-open-file"
          onClick={(e) => {
            void openProject()
            e.currentTarget.blur()
          }}
        >
          <FolderOpenIcon size={16} />
          {ru.start.openFile}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          title={`${ru.start.newProjectTitle}${newHint}`}
          data-testid="start-new"
          onClick={(e) => {
            void newProject()
            e.currentTarget.blur()
          }}
        >
          <PlusIcon size={16} />
          {ru.start.newProject}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={(e) => {
            openSettings()
            e.currentTarget.blur()
          }}
          title={`${ru.topBar.settingsTitle}${settingsHint}`}
          aria-label={ru.topBar.settings}
          data-testid="open-settings"
        >
          <GearIcon size={18} />
        </button>
      </header>
      <div className="start__scroll">
        <div className="start__inner">
          <ProjectBannersHost />
          <h1 className="start__title">{ru.start.title}</h1>
          <Notice />
          <Content />
          {folder && (
            <p className="start__folder" data-testid="start-folder" title={folder}>
              {ru.start.folderNote(folder)}
            </p>
          )}
        </div>
      </div>
      {dragActive && <div className="stage__drop-hint">{ru.stage.dropHere}</div>}
    </main>
  )
}

/** Плашки (ошибка открытия, копия работы после сбоя) показываются и на стартовом экране. */
function ProjectBannersHost(): React.JSX.Element {
  return (
    <div className="start__banners">
      <ImportBanner />
      <SettingsWarning />
      <ProjectBanners />
    </div>
  )
}
