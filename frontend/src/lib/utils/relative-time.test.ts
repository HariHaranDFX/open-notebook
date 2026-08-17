import { describe, expect, it } from 'vitest'

import { formatCompactRelativeTime } from './relative-time'

describe('formatCompactRelativeTime', () => {
  it('formats recent timestamps compactly with locale-aware units', () => {
    const now = new Date('2026-08-14T12:00:00Z')

    expect(formatCompactRelativeTime('2026-08-14T09:00:00Z', 'en-US', now)).toBe('3h ago')
    expect(formatCompactRelativeTime('2026-08-12T12:00:00Z', 'en-US', now)).toBe('2d ago')
  })
})
