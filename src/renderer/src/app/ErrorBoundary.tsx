// Граница ошибок: если часть интерфейса упала при отрисовке, вместо белого экрана показываем понятное сообщение.
// Бывает двух видов: app — на весь экран (корень приложения), panel — на месте одной области, остальное продолжает работать.
import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { ru } from '../i18n/ru'
import { useCrashStore, type CrashAreaName } from './crashStore'
import { buildErrorReport, copyText, logError, restartWindow } from './errorLog'

/** Тестовая поломка (см. testHooks.ts): без флага FLOW_TEST_CRASH никогда не срабатывает. */
export function CrashProbe({ area }: { area: CrashAreaName }): null {
  const armed = useCrashStore((s) => s.armed)
  if (armed === area) throw new Error(`Тестовая поломка: ${area}`)
  return null
}

interface FallbackProps {
  area: CrashAreaName
  variant: 'app' | 'panel'
  className?: string
  error: Error
  componentStack: string
  onRetry: () => void
}

function ErrorFallback(props: FallbackProps): React.JSX.Element {
  const { area, variant, error, componentStack } = props
  const [copy, setCopy] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [restarting, setRestarting] = useState(false)
  const areaName = ru.errors.areas[area] ?? area
  const text = variant === 'app' ? ru.errors.appText : ru.errors.panelText(areaName)
  const details = `${error.name}: ${error.message}\n\n${componentStack.trim()}`.trim()

  return (
    <div
      className={[
        'boundary',
        variant === 'app' ? 'boundary--app' : 'boundary--panel',
        props.className ?? ''
      ].join(' ')}
      role="alert"
      data-testid="error-boundary"
      data-area={area}
    >
      <div className="boundary__card">
        <h2 className="boundary__title" data-testid="error-title">
          {ru.errors.title}
        </h2>
        <p className="boundary__text">{text}</p>
        <div className="boundary__actions">
          {variant === 'panel' && (
            <button type="button" className="btn" data-testid="error-retry" onClick={props.onRetry}>
              {ru.errors.retry}
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={restarting}
            data-testid="error-restart"
            onClick={() => {
              setRestarting(true)
              void restartWindow()
            }}
          >
            {ru.errors.restart}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="error-copy"
            onClick={() => {
              void buildErrorReport(areaName, error, componentStack)
                .then(copyText)
                .then((ok) => setCopy(ok ? 'ok' : 'fail'))
            }}
          >
            {ru.errors.copy}
          </button>
        </div>
        {copy !== 'idle' && (
          <p className="boundary__copied" role="status" data-testid="error-copy-status">
            {copy === 'ok' ? ru.errors.copied : ru.errors.copyFailed}
          </p>
        )}
        <details className="boundary__details">
          <summary>{ru.errors.details}</summary>
          <pre data-testid="error-details">{details}</pre>
        </details>
      </div>
    </div>
  )
}

interface Props {
  area: CrashAreaName
  variant?: 'app' | 'panel'
  /** Класс области сетки окна (чтобы сообщение заняло место сломавшейся панели). */
  className?: string
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? ''
    this.setState({ componentStack })
    logError(`ErrorBoundary:${this.props.area}`, error, `Компоненты:${componentStack}`)
  }

  private retry = (): void => {
    useCrashStore.getState().reset()
    this.setState({ error: null, componentStack: '' })
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    return (
      <ErrorFallback
        area={this.props.area}
        variant={this.props.variant ?? 'panel'}
        className={this.props.className}
        error={error}
        componentStack={componentStack}
        onRetry={this.retry}
      />
    )
  }
}
