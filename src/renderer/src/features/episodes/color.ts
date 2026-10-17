/** Цвет текста (тёмный или белый), который читается на фоне заданного цвета #rrggbb. */
export function readableOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#0b0d10'
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  // Воспринимаемая яркость (Rec. 601).
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.55 ? '#0b0d10' : '#ffffff'
}
