import { describe, expect, it } from 'vitest'
import { isNavItemActive } from './nav-active'

const HREFS = [
  '/sources',
  '/notebooks',
  '/search',
  '/podcasts',
  '/settings/api-keys',
  '/transformations',
  '/settings',
  '/advanced',
] as const

describe('isNavItemActive', () => {
  it('activates only Models on /settings/api-keys, not Settings', () => {
    expect(isNavItemActive('/settings/api-keys', '/settings/api-keys', HREFS)).toBe(true)
    expect(isNavItemActive('/settings/api-keys', '/settings', HREFS)).toBe(false)
  })

  it('activates only Settings on /settings', () => {
    expect(isNavItemActive('/settings', '/settings', HREFS)).toBe(true)
    expect(isNavItemActive('/settings', '/settings/api-keys', HREFS)).toBe(false)
  })

  it('activates parent for nested paths without a dedicated nav item', () => {
    expect(isNavItemActive('/notebooks/abc', '/notebooks', HREFS)).toBe(true)
  })
})
