/**
 * Render an elapsed time for the header badge, accurate to the second.
 *
 * The value ticks once a second while a request is running, so a decimal place
 * would only add jitter. Under a minute reads `3s`; past that it becomes
 * `1m1s`, with the seconds always padded (`1m01s`) so the width stops jumping.
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s'

  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/**
 * 顶栏剩余时长：不足 1 小时显示 `mm:ss`，满 1 小时显示 `h:mm:ss`。
 * 秒数始终补零，避免宽度跳动。
 */
export function formatRemainingSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}
