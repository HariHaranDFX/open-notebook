import { describe, expect, it } from 'vitest'
import { canAccessAdminUi } from './admin-access'

describe('canAccessAdminUi', () => {
  it('allows everyone when auth is disabled (open mode)', () => {
    expect(canAccessAdminUi(false, null)).toBe(true)
    expect(canAccessAdminUi(false, 'user')).toBe(true)
  })

  it('allows only admin when auth is enabled', () => {
    expect(canAccessAdminUi(true, 'admin')).toBe(true)
    expect(canAccessAdminUi(true, 'user')).toBe(false)
    expect(canAccessAdminUi(true, null)).toBe(false)
  })

  it('denies until auth requirement is known', () => {
    expect(canAccessAdminUi(null, 'admin')).toBe(false)
  })
})
