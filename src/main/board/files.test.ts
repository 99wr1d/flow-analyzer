import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safeFileName } from '../../shared/board/fileName'
import { boardToFile, newBoard, type Board } from '../../shared/board/schema'
import {
  boardsFolder,
  createBoardFile,
  listBoards,
  readBoardFile,
  uniquePath,
  writeBoardFile,
  writeErrorMessage
} from './files'

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
  it('имена устройств Windows получают «_»', () => {
    expect(safeFileName('CON')).toBe('CON_')
    expect(safeFileName('nul')).toBe('nul_')
    expect(safeFileName('Com1')).toBe('Com1_')
    expect(safeFileName('LPT9')).toBe('LPT9_')
    expect(safeFileName('aux.txt')).toBe('aux_.txt')
    expect(safeFileName('con. ')).toBe('con_')
    expect(safeFileName('Conan')).toBe('Conan')
    expect(safeFileName('COM10')).toBe('COM10')
  })
  it('убирает точки и пробелы в конце', () => {
    expect(safeFileName('План...  ')).toBe('План')
    expect(safeFileName('...')).toBe('Доска')
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

  it('ошибки записи — по-русски; mkdir поверх файла не даёт английского текста', async () => {
    expect(writeErrorMessage({ code: 'EACCES' })).toMatch(/Нет доступа/)
    expect(writeErrorMessage({ code: 'EPERM' })).toMatch(/Нет доступа/)
    expect(writeErrorMessage({ code: 'ENOSPC' })).toBe('На диске не хватает места')
    expect(writeErrorMessage(new Error('boom'))).toBe('Не удалось записать файл')
    await writeFile(join(dir, 'файл'), 'x')
    const board = newBoard('Т', new Date('2026-01-01T00:00:00Z'))
    await expect(writeBoardFile(join(dir, 'файл', 'a', 'x.flowboard'), board)).rejects.toThrow(
      /^[^A-Za-z]*$/
    )
  })

  it('нет папки: пустой список; нет файла: ok false', async () => {
    expect(await listBoards(join(dir, 'нет'))).toEqual([])
    expect((await readBoardFile(join(dir, 'нет.flowboard'))).ok).toBe(false)
  })
})

describe('createBoardFile', () => {
  it('не удалась запись содержимого — пустой файл-заготовка удалён, ошибка по-русски', async () => {
    const broken = { ...newBoard('Сбой', new Date()), extra: 1n } as unknown as Board
    await expect(createBoardFile(dir, 'Сбой', broken)).rejects.toThrow(/[а-яё]/i)
    expect(await readdir(dir)).toEqual([])
  })
  it('успешное создание не затирает чужое имя', async () => {
    const a = await createBoardFile(dir, 'Доска', newBoard('A', new Date()))
    const b = await createBoardFile(dir, 'Доска', newBoard('B', new Date()))
    expect(a).not.toBe(b)
  })
})

describe('карточка повреждённой доски', () => {
  it('в карточке фиксированный русский текст', async () => {
    const good = JSON.parse(boardToFile(newBoard('x', new Date())))
    const bad = { ...good, frameCount: 0 }
    await writeFile(join(dir, 'a.flowboard'), JSON.stringify(bad), 'utf8')
    const cards = await listBoards(dir)
    expect(cards[0]).toMatchObject({ status: 'error', error: 'Файл доски повреждён' })
  })
})
