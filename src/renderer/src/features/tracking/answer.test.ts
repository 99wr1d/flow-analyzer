import { describe, expect, it } from 'vitest'
import { sendAnswer } from './answer'

describe('ответ на «Кто из них ваш?»', () => {
  it('ответ принят — ошибки нет, задача не отменяется', async () => {
    const calls: string[] = []
    const err = await sendAnswer(
      {
        resolveTracking: async (jobId, index, target) => {
          calls.push(`resolve ${jobId} ${index} ${target}`)
        },
        cancelTracking: async (jobId) => {
          calls.push(`cancel ${jobId}`)
        }
      },
      'job-1',
      2,
      1
    )
    expect(err).toBeNull()
    expect(calls).toEqual(['resolve job-1 2 1'])
  })

  it('ответ отклонён — задача отменяется и возвращается сообщение (задача не висит молча)', async () => {
    const calls: string[] = []
    const err = await sendAnswer(
      {
        resolveTracking: async () => {
          throw new Error('Эта рамка уже занята другой целью')
        },
        cancelTracking: async (jobId) => {
          calls.push(`cancel ${jobId}`)
          throw new Error('уже закончилась')
        }
      },
      'job-2',
      0,
      0
    )
    expect(err).toBe('Эта рамка уже занята другой целью')
    expect(calls).toEqual(['cancel job-2'])
  })
})
