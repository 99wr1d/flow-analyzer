// Чистая логика для scripts/gen-notices.mjs: разбор дерева зависимостей (npm ls --json --long) и сборка текста уведомлений.
// Вынесена отдельно, чтобы проверяться юнит-тестами без запуска npm.

/** Лицензия пакета в виде строки: у разных пакетов поле license — строка, объект {type} или список. */
export function normalizeLicense(value) {
  if (!value) return 'UNKNOWN'
  if (typeof value === 'string') return value.trim() || 'UNKNOWN'
  if (Array.isArray(value)) {
    const parts = value.map(normalizeLicense).filter((x) => x !== 'UNKNOWN')
    return parts.length > 0 ? `(${parts.join(' OR ')})` : 'UNKNOWN'
  }
  if (typeof value === 'object' && typeof value.type === 'string')
    return value.type.trim() || 'UNKNOWN'
  return 'UNKNOWN'
}

function repositoryUrl(node) {
  const repo = node.repository
  const url = typeof repo === 'string' ? repo : repo && typeof repo === 'object' ? repo.url : null
  if (url)
    return String(url)
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
  return typeof node.homepage === 'string' ? node.homepage : null
}

/**
 * Обходит дерево зависимостей (результат `npm ls --omit=dev --all --json --long`) и возвращает список уникальных пакетов
 * name@version. Узлы без версии (необязательные пакеты, которых нет на диске) пропускаются.
 */
export function collectPackages(tree) {
  const seen = new Map()
  const walk = (deps) => {
    for (const [key, node] of Object.entries(deps ?? {})) {
      if (!node || typeof node !== 'object') continue
      const name = typeof node.name === 'string' && node.name ? node.name : key
      if (typeof node.version === 'string' && node.version) {
        const id = `${name}@${node.version}`
        if (!seen.has(id)) {
          seen.set(id, {
            name,
            version: node.version,
            license: normalizeLicense(node.license),
            path: typeof node.path === 'string' ? node.path : null,
            url: repositoryUrl(node)
          })
        }
      }
      walk(node.dependencies)
    }
  }
  walk(tree?.dependencies)
  return [...seen.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)
  )
}

/** Какой из файлов в папке пакета — текст лицензии (LICENSE, LICENCE, COPYING…). Если нет, null. */
export function pickLicenseFile(fileNames) {
  const candidates = fileNames.filter((n) => /^(licen[sc]e|copying)([-._].*)?$/i.test(n))
  const rank = (n) => {
    const base = n.toLowerCase()
    const order = [
      'license',
      'license.txt',
      'license.md',
      'licence',
      'licence.txt',
      'licence.md',
      'copying'
    ]
    const i = order.indexOf(base)
    return i === -1 ? 100 : i
  }
  candidates.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return candidates[0] ?? null
}

const RULE = '='.repeat(78)
const THIN = '-'.repeat(78)

/** Итоговый текст. texts: Map «name@version» → текст лицензии (нет записи — пакет без файла лицензии). */
export function formatNotices(packages, texts, header) {
  const lines = [header.trim(), '', `Компонентов: ${packages.length}`, '']
  for (const p of packages) {
    const id = `${p.name}@${p.version}`
    lines.push(RULE, id, `Лицензия: ${p.license}`)
    if (p.url) lines.push(`Источник: ${p.url}`)
    lines.push(THIN)
    const text = texts.get(id)
    lines.push(
      text
        ? text.trim()
        : '(файл с текстом лицензии в пакете не найден; лицензия указана в его описании)',
      ''
    )
  }
  return lines.join('\n') + '\n'
}

const MIT_MICROSOFT = `MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

const ISC_GUID = `ISC License

Copyright (c) nicolas (https://github.com/NicolasDeveloper/guid-typescript)

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

(В пакете нет файла лицензии; текст — стандартный ISC, лицензия объявлена в package.json пакета.)`

const ORT_NOTE = `\n\nЗависимости, скомпилированные в WebAssembly ONNX Runtime, перечислены в
https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt (в npm-пакет этот файл не входит).`

/** Тексты лицензий для пакетов, у которых нет файла лицензии. Ключ — имя пакета. */
const FALLBACK_TEXTS = {
  'onnxruntime-web': MIT_MICROSOFT + ORT_NOTE,
  'onnxruntime-common': MIT_MICROSOFT,
  'guid-typescript': ISC_GUID
}

export function fallbackLicenseText(name) {
  return FALLBACK_TEXTS[name] ?? null
}
