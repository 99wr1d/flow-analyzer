import { describe, expect, it } from 'vitest'
import {
  collectPackages,
  fallbackLicenseText,
  formatNotices,
  normalizeLicense,
  pickLicenseFile
} from './notices-lib.mjs'

describe('лицензия пакета', () => {
  it('строка, объект, список, пусто', () => {
    expect(normalizeLicense('MIT')).toBe('MIT')
    expect(normalizeLicense({ type: 'ISC' })).toBe('ISC')
    expect(normalizeLicense([{ type: 'MIT' }, { type: 'Apache-2.0' }])).toBe('(MIT OR Apache-2.0)')
    expect(normalizeLicense(undefined)).toBe('UNKNOWN')
    expect(normalizeLicense('  ')).toBe('UNKNOWN')
    expect(normalizeLicense({})).toBe('UNKNOWN')
  })
})

describe('разбор дерева зависимостей', () => {
  const tree = {
    name: 'app',
    dependencies: {
      zod: {
        version: '4.6.7',
        name: 'zod',
        license: 'MIT',
        path: '/n/zod',
        repository: { url: 'git+https://github.com/colinhacks/zod.git' }
      },
      'ffmpeg-static': {
        version: '5.3.0',
        license: 'GPL-3.0-or-later',
        dependencies: {
          debug: {
            version: '4.4.3',
            license: 'MIT',
            dependencies: { ms: { version: '2.1.3', license: 'MIT' } }
          },
          // тот же пакет встречается ещё раз глубже
          zod: { version: '4.6.7', license: 'MIT' },
          missing: {},
          '@types/node': { version: '10.17.60', license: 'MIT' }
        }
      },
      '@types/node': { version: '24.19.2', license: 'MIT' }
    }
  }

  it('уникальные name@version, отсортированы, пустые узлы пропущены', () => {
    const list = collectPackages(tree)
    expect(list.map((p) => `${p.name}@${p.version}`)).toEqual([
      '@types/node@10.17.60',
      '@types/node@24.19.2',
      'debug@4.4.3',
      'ffmpeg-static@5.3.0',
      'ms@2.1.3',
      'zod@4.6.7'
    ])
  })

  it('имя берётся из ключа, лицензия и ссылка нормализуются', () => {
    const ffmpeg = collectPackages(tree).find((p) => p.name === 'ffmpeg-static')
    expect(ffmpeg?.license).toBe('GPL-3.0-or-later')
    const zod = collectPackages(tree).find((p) => p.name === 'zod')
    expect(zod?.url).toBe('https://github.com/colinhacks/zod')
    expect(zod?.path).toBe('/n/zod')
  })

  it('пустое дерево — пустой список', () => {
    expect(collectPackages({})).toEqual([])
    expect(collectPackages(null)).toEqual([])
  })
})

describe('файл лицензии в папке пакета', () => {
  it('предпочитает LICENSE, понимает LICENCE и COPYING, чужие файлы игнорирует', () => {
    expect(pickLicenseFile(['README.md', 'LICENSE', 'index.js'])).toBe('LICENSE')
    expect(pickLicenseFile(['license.md', 'LICENSE-MIT.txt'])).toBe('license.md')
    expect(pickLicenseFile(['LICENCE'])).toBe('LICENCE')
    expect(pickLicenseFile(['COPYING'])).toBe('COPYING')
    expect(pickLicenseFile(['LICENSE-MIT', 'LICENSE-APACHE'])).toBe('LICENSE-APACHE')
    expect(pickLicenseFile(['package.json', 'licenses.json'])).toBeNull()
  })
})

describe('текст уведомлений', () => {
  const packages = [
    { name: 'a', version: '1.0.0', license: 'MIT', path: null, url: 'https://x/a' },
    { name: 'b', version: '2.0.0', license: 'ISC', path: null, url: null }
  ]
  it('шапка, число компонентов, текст лицензии или пометка об отсутствии', () => {
    const text = formatNotices(packages, new Map([['a@1.0.0', 'MIT License text']]), 'Шапка')
    expect(text.startsWith('Шапка')).toBe(true)
    expect(text).toContain('Компонентов: 2')
    expect(text).toContain('a@1.0.0\nЛицензия: MIT\nИсточник: https://x/a')
    expect(text).toContain('MIT License text')
    expect(text).toContain('b@2.0.0\nЛицензия: ISC')
    expect(text).toContain('файл с текстом лицензии в пакете не найден')
  })
})

describe('запасные тексты лицензий', () => {
  it('onnxruntime-web/-common — MIT Microsoft, у web есть ссылка на ThirdPartyNotices', () => {
    for (const name of ['onnxruntime-web', 'onnxruntime-common']) {
      expect(fallbackLicenseText(name)).toContain('Copyright (c) Microsoft Corporation')
      expect(fallbackLicenseText(name)).toContain('Permission is hereby granted')
    }
    expect(fallbackLicenseText('onnxruntime-web')).toContain(
      'https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt'
    )
  })
  it('guid-typescript — ISC; для прочих пакетов запасного текста нет', () => {
    expect(fallbackLicenseText('guid-typescript')).toContain('ISC License')
    expect(fallbackLicenseText('zod')).toBeNull()
  })
})
