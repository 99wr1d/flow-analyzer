// Ключ «газон» в интерфейсе: какие значения уходят и на экран, и в экспорт (effectiveKey — один источник для обоих).
import { beforeEach, describe, expect, it } from 'vitest'
import { autoGrassTuning } from '../../../../shared/grassKey'
import { effectiveKey, useGrassStore } from './grassStore'

const VIDEO = 'video-1'
/** Бледный газон телетрансляции (так его находит estimateGrassColor на матче Лиги чемпионов). */
const BROADCAST = '#6c7b48'

describe('effectiveKey: допуск по цвету газона, пока пользователь его не менял', () => {
  it('найденный по кадру бледный газон — узкий допуск (белая форма не газон)', () => {
    const k = effectiveKey(
      { userKey: null, estimate: { videoId: VIDEO, color: BROADCAST, found: true, time: 3 } },
      VIDEO
    )
    expect(k.color).toBe(BROADCAST)
    expect(k.similarity).toBeCloseTo(autoGrassTuning(BROADCAST).similarity, 9)
    expect(k.blend).toBeCloseTo(autoGrassTuning(BROADCAST).blend, 9)
    expect(k.similarity + k.blend).toBeLessThan(0.07 + 0.05 - 0.05)
  })

  it('значения, которые пользователь задал сам (и сохранил в проекте), не меняются', () => {
    const userKey = { color: BROADCAST, similarity: 0.2, blend: 0.1, auto: false }
    const k = effectiveKey({ userKey, estimate: null }, VIDEO)
    expect(k.similarity).toBe(0.2)
    expect(k.blend).toBe(0.1)
  })
})

describe('пипетка: новый цвет', () => {
  beforeEach(() => useGrassStore.getState().reset())

  it('чувствительность, которую не трогали, считается по новому цвету', () => {
    useGrassStore.getState().pickColor(BROADCAST, 1)
    const u = useGrassStore.getState().userKey
    expect(u?.similarity).toBeCloseTo(autoGrassTuning(BROADCAST).similarity, 9)
    expect(u?.auto).toBe(false)
  })

  it('ручная чувствительность сохраняется при смене цвета', () => {
    useGrassStore.getState().load({ color: '#2f8a3f', similarity: 0.15, blend: 0.08, auto: true })
    useGrassStore.getState().pickColor(BROADCAST, 1)
    expect(useGrassStore.getState().userKey?.similarity).toBe(0.15)
    expect(useGrassStore.getState().userKey?.blend).toBe(0.08)
  })
})
