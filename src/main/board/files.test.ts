import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safeFileName } from '../../shared/board/fileName'
import { newBoard } from '../../shared/board/schema'
import { boardsFolder, listBoards, readBoardFile, uniquePath, writeBoardFile } from './files'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'board-files-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('safeFileName', () => {
  it('убирает запрещённые символы и схлопывает пробелы', () => {
    expect(safeFileName('Бросок: 1/2?')).toBe('Бросок 12')
    expect(safeFileName('  a \t  b\u0001 ')).toBe('a b')
  })
  it('обрезает до 80 и подставляет «Доска» для пустого', () => {
    expect(safeFileName('x'.repeat(200))).toHaveLength(80)
    expect(safeFileName('?*:')).toBe('Доска')
  })
})

describe('файлы досок', () => {
  it('папка досок лежит в папке проектов', () => {
    expect(boardsFolder(dir)).toBe(join(dir, 'Доски'))
  })

  it('uniquePath добавляет « (2)», « (3)»', async () => {
    expect(await uniquePath(dir, 'Атака', 'flowboard')).toBe(join(dir, 'Атака.flowboard'))
    await writeFile(join(dir, 'Атака.flowboard'), 'x')
    expect(await uniquePath(dir, 'Атака', 'flowboard')).toBe(join(dir, 'Атака (2).flowboard'))
    await writeFile(join(dir, 'Атака (2).flowboard'), 'x')
    expect(await uniquePath(dir, 'Атака', 'flowboard')).toBe(join(dir, 'Атака (3).flowboard'))
  })

  it('запись и чтение возвращают ту же доску', async () => {
    const board = newBoard('Тест', new Date('2026-01-01T00:00:00Z'))
    const path = join(dir, 'a', 'Тест.flowboard')
    await writeBoardFile(path, board)
    expect(await readBoardFile(path)).toEqual({ ok: true, board })
  })

  it('повреждённый файл: ok false, в списке карточка с ошибкой, без исключения', async () => {
    const good = newBoard('Хорошая', new Date('2026-01-01T00:00:00Z'))
    await writeBoardFile(join(dir, 'good.flowboard'), good)
    await writeFile(join(dir, 'bad.flowboard'), '{ не json')
    await writeFile(join(dir, 'other.txt'), 'x')
    const read = await readBoardFile(join(dir, 'bad.flowboard'))
    expect(read.ok).toBe(false)
    const cards = await listBoards(dir)
    expect(cards.map((c) => [c.title, c.status])).toEqual([
      ['Хорошая', 'ok'],
      ['bad', 'error']
    ])
    expect(cards[0]).toMatchObject({ frames: 1, thumb: null })
    expect(cards[1].error).toBeTruthy()
  })

  it('нет папки: пустой список; нет файла: ok false', async () => {
    expect(await listBoards(join(dir, 'нет'))).toEqual([])
    expect((await readBoardFile(join(dir, 'нет.flowboard'))).ok).toBe(false)
  })
})
