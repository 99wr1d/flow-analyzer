// Измерительная «проба», которая внедряется в страницу приложения. Время считается внутри страницы (performance.now),
// чтобы в замер не попадали задержки Playwright. Условия ожидания описываются данными (CSP страницы не даёт eval).
import type { Page } from '@playwright/test'

export interface Cond {
  /** data-testid элемента. */
  id: string
  mode: 'present' | 'absent' | 'text' | 'count' | 'seeked'
  /** Для text — ожидаемый текст; для count — ожидаемое число элементов с этим testid. */
  value?: string | number
}

export interface Probe {
  arm(name: string, event: 'keydown' | 'click' | 'pointerdown', cond: Cond): void
  done: Record<string, { dom: number; paint: number } | undefined>
}

declare global {
  interface Window {
    __p?: Probe
  }
}

function install(): void {
  let seeked = false
  document.addEventListener('seeked', () => (seeked = true), true)
  const check = (c: Cond): boolean => {
    const list = document.querySelectorAll(`[data-testid="${c.id}"]`)
    switch (c.mode) {
      case 'present':
        return list.length > 0
      case 'seeked':
        return seeked
      case 'absent':
        return list.length === 0
      case 'text':
        return list.length > 0 && list[0].textContent === String(c.value)
      default:
        return list.length === c.value
    }
  }
  const done: Probe['done'] = {}
  window.__p = {
    done,
    arm(name, event, cond) {
      done[name] = undefined
      seeked = false
      const onEvent = (): void => {
        const t0 = performance.now()
        seeked = false
        const finish = (): void => {
          const dom = performance.now() - t0
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              done[name] = { dom, paint: performance.now() - t0 }
            })
          )
        }
        const obs = new MutationObserver(() => {
          if (check(cond)) {
            obs.disconnect()
            clearInterval(iv)
            finish()
          }
        })
        obs.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true
        })
        const iv = setInterval(() => {
          if (check(cond)) {
            obs.disconnect()
            clearInterval(iv)
            finish()
          }
        }, 5)
        setTimeout(() => {
          obs.disconnect()
          clearInterval(iv)
          if (!done[name]) done[name] = { dom: -1, paint: -1 }
        }, 120_000)
      }
      document.addEventListener(event, onEvent, { capture: true, once: true })
    }
  }
}

export async function installProbe(win: Page): Promise<void> {
  await win.evaluate(install)
}

/** Ждёт результата armed-замера и возвращает миллисекунды до готового DOM и до отрисовки. */
export async function takeProbe(
  win: Page,
  name: string,
  timeout = 120_000
): Promise<{ dom: number; paint: number }> {
  await win.waitForFunction((n) => window.__p?.done[n] !== undefined, name, { timeout })
  return win.evaluate((n) => window.__p!.done[n]!, name)
}
