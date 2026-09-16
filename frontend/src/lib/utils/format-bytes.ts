/**
 * Human-readable byte count. Two uses today (Settings cleanup preview,
 * Source Details original-file size); if this gains a third, promote it
 * to Intl.NumberFormat with 'unit' + 'byte' — that has locale-aware
 * separators but slightly less predictable magnitude boundaries.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
