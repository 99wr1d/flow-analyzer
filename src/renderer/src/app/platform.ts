import { ru } from '../i18n/ru'

export function platformLabel(platform: string): string {
  return ru.platforms[platform] ?? platform
}

export function formatStatus(info: { name: string; version: string; platform: string }): string {
  return `${info.name} ${info.version} · ${platformLabel(info.platform)}`
}
