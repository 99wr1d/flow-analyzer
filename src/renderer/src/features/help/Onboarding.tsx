import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useViewStore, type AppView } from '../../app/viewStore'
import { ru } from '../../i18n/ru'
import { CloseIcon } from '../../ui/icons'
import { useSettingsStore } from '../settings/settingsStore'
import { TIPS_COUNT, goTip, markOnboardingSeen, stopTips, useHelpStore } from './helpStore'
import { placeTip, type Placement } from './tipPlacement'

interface StepSpec {
  /** Селекторы элемента, на который указывает подсказка (первый найденный). */
  targets: string[]
  /** На каком экране шаг имеет смысл: «any» — на любом, «workspace» — только в рабочей области. */
  view: 'any' | AppView
}

/** Шаги тура: тексты — в ru.tips.steps, а здесь — на какие настоящие элементы интерфейса они указывают. */
const STEPS: readonly StepSpec[] = [
  { targets: ['[data-testid="open-video"]'], view: 'any' },
  { targets: ['[data-testid="tag-panel"]'], view: 'workspace' },
  { targets: ['[data-testid="pitch-calibrate"]', '[data-testid="tool-rail"]'], view: 'workspace' },
  { targets: ['[data-testid="export-open"]'], view: 'workspace' }
]

function findTarget(step: StepSpec): HTMLElement | null {
  for (const selector of step.targets) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) return el
  }
  return null
}

/** Следит за положением элемента: пересчёт при изменении размеров и прокрутке. */
function useTargetRect(step: StepSpec, active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (!active) return
    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = findTarget(step)
        const next = el ? el.getBoundingClientRect() : null
        setRect((prev) =>
          prev &&
          next &&
          prev.x === next.x &&
          prev.y === next.y &&
          prev.width === next.width &&
          prev.height === next.height
            ? prev
            : next
        )
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    // Элемент может появиться чуть позже (экран открывается, видео загружается).
    const timer = window.setInterval(update, 400)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.clearInterval(timer)
    }
  }, [step, active])
  return active ? rect : null
}

/**
 * Подсказки первого запуска: маленькая карточка со стрелкой на настоящий элемент окна (кнопка, панель).
 * Ничего не блокирует: клавиши и мышь работают как обычно. Тур запускается один раз (флаг в настройках)
 * и в любой момент — из меню «Справка» → «Подсказки».
 */
export function Onboarding(): React.JSX.Element | null {
  const active = useHelpStore((s) => s.tipsActive)
  const index = useHelpStore((s) => s.tipsStep)
  const view = useViewStore((s) => s.view)
  const booting = useViewStore((s) => s.booting)
  const spec = STEPS[index]
  const waiting = spec.view !== 'any' && spec.view !== view
  const rect = useTargetRect(spec, active && !booting && !waiting)
  const cardRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const text = ru.tips.steps[index]

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || !rect) {
      setPlacement(null)
      return
    }
    setPlacement(
      placeTip(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [rect, index, active])

  const finish = useCallback(() => {
    stopTips()
    void markOnboardingSeen()
  }, [])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)
      )
        return
      // Пока открыто окно (настройки, экспорт и т. п.), Esc принадлежит ему.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, finish])

  // Тур запомнен как показанный сразу, как только он появился на экране: «один раз» значит один раз.
  const shown = active && !booting && !waiting && rect !== null
  useEffect(() => {
    if (shown && !useSettingsStore.getState().settings.onboardingSeen) void markOnboardingSeen()
  }, [shown])

  if (!active || booting) return null
  if (waiting) {
    return (
      <div className="tip-wait" role="status" data-testid="tip-waiting">
        <span>{ru.tips.waiting}</span>
        <button
          type="button"
          className="icon-btn icon-btn--small"
          aria-label={ru.tips.skip}
          title={ru.tips.skip}
          data-testid="tip-skip"
          onClick={finish}
        >
          <CloseIcon size={13} />
        </button>
      </div>
    )
  }
  if (!rect) return null

  const last = index === TIPS_COUNT - 1
  const side = placement?.side ?? 'bottom'
  return (
    <>
      <div
        className="tip-ring"
        aria-hidden="true"
        style={{
          left: rect.left - 4,
          top: rect.top - 4,
          width: rect.width + 8,
          height: rect.height + 8
        }}
      />
      <div
        ref={cardRef}
        className={`tip tip--${side}`}
        role="region"
        aria-label={ru.tips.region}
        data-testid="tip"
        data-step={index}
        style={{
          left: placement?.left ?? -9999,
          top: placement?.top ?? -9999,
          ['--arrow' as string]: `${placement?.arrow ?? 24}px`
        }}
      >
        <div className="tip__top">
          <span className="tip__step" data-testid="tip-step">
            {ru.tips.stepOf(index + 1, TIPS_COUNT)}
          </span>
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label={ru.tips.skip}
            title={ru.tips.skip}
            data-testid="tip-close"
            onClick={finish}
          >
            <CloseIcon size={13} />
          </button>
        </div>
        <h3 className="tip__title" data-testid="tip-title">
          {text.title}
        </h3>
        <p className="tip__text">{text.text}</p>
        <div className="tip__actions">
          <button type="button" className="btn btn--small" data-testid="tip-skip" onClick={finish}>
            {ru.tips.skip}
          </button>
          <span className="tip__spacer" />
          {index > 0 && (
            <button
              type="button"
              className="btn btn--small"
              data-testid="tip-back"
              onClick={() => goTip(index - 1)}
            >
              {ru.tips.back}
            </button>
          )}
          <button
            type="button"
            className="btn btn--small btn--primary"
            data-testid="tip-next"
            onClick={last ? finish : () => goTip(index + 1)}
          >
            {last ? ru.tips.done : ru.tips.next}
          </button>
        </div>
      </div>
    </>
  )
}
