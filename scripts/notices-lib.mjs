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
