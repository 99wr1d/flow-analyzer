import { useCallback, useEffect, useRef, useState } from 'react'
import type { AboutInfo, LicenseTexts } from '../../../../shared/log'
import { ru } from '../../i18n/ru'
import { CloseIcon } from '../../ui/icons'
import { Logo } from '../../ui/Logo'
import { useFocusTrap } from '../export/useFocusTrap'
import { closeAbout, useHelpStore } from './helpStore'

type LicenseTab = 'notices' | 'ffmpeg'

function Body(): React.JSX.Element {
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [licenses, setLicenses] = useState<LicenseTexts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [tab, setTab] = useState<LicenseTab>('notices')

  useEffect(() => {
    let alive = true
    window.api
      .getAboutInfo()
      .then((info) => alive && setAbout(info))
      .catch(() => alive && setError(ru.about.loadFailed))
    window.api
      .getLicenses()
      .then((texts) => alive && setLicenses(texts))
      .catch(() => alive && setLicenses({ ffmpeg: null, notices: null }))
    return () => {
      alive = false
    }
  }, [])

  const text = licenses ? (tab === 'notices' ? licenses.notices : licenses.ffmpeg) : null
  const missing = tab === 'notices' ? ru.about.noticesMissing : ru.about.ffmpegMissing

  return (
    <div className="about__scroll">
      <div className="about__hero">
        <Logo size={44} />
        <div>
          <h3 className="about__name" data-testid="about-name">
            {about?.name ?? ru.appName}
          </h3>
          <p className="about__tagline">{ru.about.tagline}</p>
          <p className="about__version" data-testid="about-version">
            {about ? ru.about.version(about.version) : ru.about.loading}
          </p>
        </div>
      </div>
      {error && (
        <p className="modal__error" role="alert">
          {error}
        </p>
      )}
      <p className="about__author" data-testid="about-author">
        {ru.about.author}
      </p>

      <h3 className="about__h">{ru.about.versions}</h3>
      <dl className="about__versions" data-testid="about-versions">
        <dt>{ru.about.electron}</dt>
        <dd data-testid="about-electron">{about?.electron ?? '…'}</dd>
        <dt>{ru.about.chromium}</dt>
        <dd data-testid="about-chromium">{about?.chromium ?? '…'}</dd>
        <dt>{ru.about.node}</dt>
        <dd data-testid="about-node">{about?.node ?? '…'}</dd>
      </dl>

      <h3 className="about__h">{ru.about.logs}</h3>
      <p className="about__muted">{ru.about.logsText}</p>
      <div className="about__logs">
        <button
          type="button"
          className="btn"
          data-testid="about-open-logs"
          onClick={() => {
            setLogsError(null)
            window.api.openLogsFolder().catch(() => setLogsError(ru.about.openLogsFailed))
          }}
        >
          {ru.about.openLogs}
        </button>
        {about?.logsDir && (
          <span className="about__path" title={about.logsDir} data-testid="about-logs-dir">
            {about.logsDir}
          </span>
        )}
      </div>
      {logsError && (
        <p className="modal__error" role="alert">
          {logsError}
        </p>
      )}

      <h3 className="about__h">{ru.about.licenses}</h3>
      <p className="about__muted">{ru.about.licenseNote}</p>
      <div className="tabs about__tabs" role="tablist">
        {(['notices', 'ffmpeg'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'tabs__btn tabs__btn--active' : 'tabs__btn'}
            data-testid={`about-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {id === 'notices' ? ru.about.tabNotices : ru.about.tabFfmpeg}
          </button>
        ))}
      </div>
      <pre className="about__license" tabIndex={0} data-testid="about-license" data-tab={tab}>
        {licenses === null ? ru.about.loading : (text ?? missing)}
      </pre>
    </div>
  )
}

/** Окно «О программе»: версия, версии Electron/Chromium/Node, автор, лицензии, кнопка «Открыть папку журналов». */
export function AboutDialog(): React.JSX.Element | null {
  const open = useHelpStore((s) => s.aboutOpen)
  const ref = useRef<HTMLDivElement>(null)
  const onEscape = useCallback(() => closeAbout(), [])
  useFocusTrap(ref, open, onEscape)

  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      data-testid="about-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeAbout()
      }}
    >
      <div
        ref={ref}
        className="modal modal--about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        tabIndex={-1}
        data-testid="about-dialog"
      >
        <header className="modal__head">
          <h2 id="about-title" className="modal__title">
            {ru.about.title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label={ru.about.close}
            title={ru.about.close}
            data-testid="about-close"
            onClick={closeAbout}
          >
            <CloseIcon size={16} />
          </button>
        </header>
        <Body />
        <footer className="modal__foot modal__foot--end">
          <button type="button" className="btn btn--primary" data-autofocus onClick={closeAbout}>
            {ru.about.close}
          </button>
        </footer>
      </div>
    </div>
  )
}
