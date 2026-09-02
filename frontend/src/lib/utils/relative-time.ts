type RelativeTimeUnit = Intl.RelativeTimeFormatUnit

const divisions: Array<{ amount: number; unit: RelativeTimeUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 30, unit: 'day' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

export function formatCompactRelativeTime(
  value: string | Date,
  language: string,
  now = new Date(),
) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  let duration = (date.getTime() - now.getTime()) / 1000

  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return new Intl.RelativeTimeFormat(language, {
        numeric: 'always',
        style: 'narrow',
      }).format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }

  return String(value)
}
