import { useEffect } from 'react'
import { AboutDialog } from '../features/help/AboutDialog'
import { BoardEditor } from '../features/board/BoardEditor'
import { autoStartTips } from '../features/help/helpStore'
import { Onboarding } from '../features/help/Onboarding'
import { ExportDialog } from '../features/export/ExportDialog'
import { StatsDialog } from '../features/stats/StatsDialog'
import { installExportProgress } from '../features/export/exportActions'
import { useCommandDispatcher } from '../features/commands/dispatcher'
import { installUnifiedHistory } from '../features/history/unified'
import { NewProjectDialog } from '../features/library/NewProjectDialog'
import { DeleteDialog } from '../features/library/DeleteDialog'
import { PropertiesDialog } from '../features/library/PropertiesDialog'
import { StartScreen } from '../features/library/StartScreen'
import { useDropImport } from '../features/player/useGlobalInput'
import { RelinkDialog } from '../features/project/RelinkDialog'
import { UnsavedDialog } from '../features/project/UnsavedDialog'
import { useProjectLifecycle } from '../features/project/useProjectLifecycle'
import { SettingsDialog } from '../features/settings/SettingsDialog'
import { useSettingsStore } from '../features/settings/settingsStore'
import { CrashProbe, ErrorBoundary } from './ErrorBoundary'
import { BottomDock } from './BottomDock'
import { EpisodesPanel } from './EpisodesPanel'
import { StatusBar } from './StatusBar'
import { ToolRail } from './ToolRail'
import { TopBar } from './TopBar'
import { VideoStage } from './VideoStage'
import { useViewStore } from './viewStore'

export function App(): React.JSX.Element {
  const loaded = useSettingsStore((s) => s.loaded)
  const dialogOpen = useSettingsStore((s) => s.dialogOpen)
  const view = useViewStore((s) => s.view)
  const booting = useViewStore((s) => s.booting)
  const onboardingSeen = useSettingsStore((s) => s.settings.onboardingSeen)
  useCommandDispatcher()
  useDropImport()
  useProjectLifecycle()

  useEffect(() => {
    const uninstall = installUnifiedHistory()
    const uninstallExport = installExportProgress()
    void useSettingsStore.getState().load()
    return () => {
      uninstall()
      uninstallExport()
    }
  }, [])

  // Первый запуск: когда настройки загружены и экран готов, показываем подсказки (один раз).
  useEffect(() => {
    if (loaded && !booting && !onboardingSeen) void autoStartTips()
  }, [loaded, booting, onboardingSeen])

  return (
    <div
      className={view === 'start' ? 'app app--start' : view === 'board' ? 'app app--board' : 'app'}
      data-settings={loaded ? 'loaded' : 'loading'}
      data-view={booting ? 'booting' : view}
    >
      <CrashProbe area="app" />
      {booting ? null : view === 'start' ? (
        <ErrorBoundary area="start">
          <StartScreen />
          <CrashProbe area="start" />
        </ErrorBoundary>
      ) : view === 'board' ? (
        <ErrorBoundary area="board" className="boundary--board">
          <BoardEditor />
          <CrashProbe area="board" />
        </ErrorBoundary>
      ) : (
        <>
          <TopBar />
          <ErrorBoundary area="tools" className="boundary--rail">
            <ToolRail />
            <CrashProbe area="tools" />
          </ErrorBoundary>
          <ErrorBoundary area="video" className="boundary--stage">
            <VideoStage />
            <CrashProbe area="video" />
          </ErrorBoundary>
          <ErrorBoundary area="episodes" className="boundary--side">
            <EpisodesPanel />
            <CrashProbe area="episodes" />
          </ErrorBoundary>
          <ErrorBoundary area="timeline" className="boundary--dock">
            <BottomDock />
            <CrashProbe area="timeline" />
          </ErrorBoundary>
        </>
      )}
      <StatusBar />
      {dialogOpen && <SettingsDialog />}
      <NewProjectDialog />
      <PropertiesDialog />
      <DeleteDialog />
      <ExportDialog />
      <StatsDialog />
      <UnsavedDialog />
      <RelinkDialog />
      <AboutDialog />
      <Onboarding />
    </div>
  )
}
