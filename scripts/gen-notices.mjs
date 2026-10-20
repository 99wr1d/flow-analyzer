// Создаёт licenses/THIRD_PARTY_NOTICES.txt: список сторонних компонентов, которые входят в программу, с их лицензиями.
// Обходит только ПРОИЗВОДСТВЕННЫЕ зависимости (npm ls --omit=dev --all). Запускается при сборке установщика
// (npm run build:win / build:unpack) и перед e2e-тестами; файл попадает в resources/licenses через extraResources.
//
// Запуск: node scripts/gen-notices.mjs [выходной файл]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectPackages, formatNotices, pickLicenseFile } from './notices-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(root, 'licenses', 'THIRD_PARTY_NOTICES.txt'))
/** Текст лицензии длиннее этого не копируем целиком (защита от случайных гигантов). */
const MAX_LICENSE_CHARS = 60_000

/** Как запустить npm без оболочки: node + npm-cli.js рядом с node; запасной путь — команда npm через оболочку. */
function npmCommand() {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return existsSync(cli)
    ? { file: process.execPath, prefix: [cli], shell: false }
    : {
        file: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        prefix: [],
        shell: process.platform === 'win32'
      }
}

function npmTree() {
  const cmd = npmCommand()
  const args = [...cmd.prefix, 'ls', '--omit=dev', '--all', '--json', '--long']
  let stdout
  try {
    stdout = execFileSync(cmd.file, args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      shell: cmd.shell,
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch (error) {
    // npm ls завершается с ненулевым кодом, если есть лишние или недостающие пакеты, но JSON при этом выдаёт.
    stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : ''
  }
  if (!stdout.trim()) throw new Error('npm ls не вернул список зависимостей')
  return JSON.parse(stdout)
}

function readLicenseText(pkg) {
  if (!pkg.path || !existsSync(pkg.path)) return null
  const file = pickLicenseFile(readdirSync(pkg.path))
  if (!file) return null
  const full = join(pkg.path, file)
  if (!statSync(full).isFile()) return null
  const text = readFileSync(full, 'utf8')
  return text.length > MAX_LICENSE_CHARS
    ? `${text.slice(0, MAX_LICENSE_CHARS)}\n[…текст обрезан…]`
    : text
}

const packages = collectPackages(npmTree())
const texts = new Map()
for (const p of packages) {
  const text = readLicenseText(p)
  if (text) texts.set(`${p.name}@${p.version}`, text)
}

const appPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const header = `FlowAnalyzer ${appPkg.version} — сторонние компоненты и их лицензии

Этот файл создаётся автоматически при сборке (scripts/gen-notices.mjs) по списку производственных зависимостей.
Кроме перечисленного ниже, в программу входят Electron и Chromium (их лицензии лежат рядом с программой в файлах
LICENSE.electron.txt и LICENSES.chromium.html) и FFmpeg (лицензия GNU GPL — файл ffmpeg-LICENSE.txt в этой же папке).`

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, formatNotices(packages, texts, header), 'utf8')
console.log(
  `Уведомления: ${packages.length} компонентов, ${texts.size} с текстом лицензии → ${out}`
)
