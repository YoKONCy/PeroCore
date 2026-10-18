/** 与设备本地时间保持一致，并明确保留时区偏移；数据库仍使用 UTC。 */
export function formatEventTime(value: string | number | Date): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  const pad = (part: number) => String(part).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  )
}

export function localMemoryDate(value: Date): string {
  return formatEventTime(value).slice(0, 10)
}
