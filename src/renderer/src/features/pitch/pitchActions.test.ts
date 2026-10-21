import { beforeEach, describe, expect, it } from 'vitest'
import { newDraft } from './draft'
import { requestCancelCalibration } from './pitchActions'
import { usePitchStore } from './pitchStore'

describe('requestCancelCalibration', () => {
  beforeEach(() => {
    usePitchStore.setState({ draft: null, confirmingCancel: false })
  })

  it('без точек отмена закрывает режим сразу', () => {
    usePitchStore.getState().openDraft(newDraft(1, 16 / 9))
    requestCancelCalibration()
    expect(usePitchStore.getState().draft).toBeNull()
    expect(usePitchStore.getState().confirmingCancel).toBe(false)
  })

  it('с поставленной точкой сначала спрашивает и ничего не стирает', () => {
    const st = usePitchStore.getState()
    st.openDraft(newDraft(1, 16 / 9))
    st.addPoint({ x: 0.2, y: 0.3 })
    requestCancelCalibration()
    expect(usePitchStore.getState().draft?.points).toHaveLength(1)
    expect(usePitchStore.getState().confirmingCancel).toBe(true)
  })

  it('закрытие черновика снимает вопрос', () => {
    const st = usePitchStore.getState()
    st.openDraft(newDraft(1, 16 / 9))
    st.addPoint({ x: 0.2, y: 0.3 })
    requestCancelCalibration()
    usePitchStore.getState().closeDraft()
    expect(usePitchStore.getState().confirmingCancel).toBe(false)
  })
})
