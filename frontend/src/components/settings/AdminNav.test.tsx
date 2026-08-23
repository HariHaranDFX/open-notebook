import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Radix Select measures its trigger via ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const push = vi.hoisted(() => vi.fn())
const currentPathname = vi.hoisted(() => ({ current: '/settings' }))
const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    // next/navigation's real redirect() interrupts rendering by throwing;
    // mirror that so AdvancedRedirect never falls through to `return undefined`.
    throw new Error(`NEXT_REDIRECT:${url}`)
  })
)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => currentPathname.current,
  redirect: redirectMock,
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}))

vi.mock('@/components/auth/AdminOnly', () => ({
  AdminOnly: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="admin-only">{children}</div>
  ),
}))

import { AdminNav } from './AdminNav'
import SettingsLayout from '@/app/(dashboard)/settings/layout'
import AdvancedRedirect from '@/app/(dashboard)/advanced/page'

// useTranslation is mocked globally in setup.ts (t returns the key string).

describe('AdminNav', () => {
  beforeEach(() => {
    currentPathname.current = '/settings'
    push.mockReset()
  })

  it('renders all four labeled administration links', () => {
    render(<AdminNav />)
    const nav = screen.getByRole('navigation', { name: 'common.accessibility.settingsNav' })

    expect(within(nav).getByRole('link', { name: 'navigation.general' })).toHaveAttribute(
      'href',
      '/settings'
    )
    expect(within(nav).getByRole('link', { name: 'navigation.models' })).toHaveAttribute(
      'href',
      '/settings/api-keys'
    )
    expect(within(nav).getByRole('link', { name: 'navigation.groups' })).toHaveAttribute(
      'href',
      '/settings/groups'
    )
    expect(within(nav).getByRole('link', { name: 'navigation.advanced' })).toHaveAttribute(
      'href',
      '/settings/advanced'
    )
  })

  it('marks General active on the section root, not a substring match', () => {
    currentPathname.current = '/settings'
    render(<AdminNav />)
    const nav = screen.getByRole('navigation', { name: 'common.accessibility.settingsNav' })

    expect(within(nav).getByRole('link', { name: 'navigation.general' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(nav).getByRole('link', { name: 'navigation.models' })
    ).not.toHaveAttribute('aria-current')
  })

  it('marks the matching item active for a nested path under it, and no other item', () => {
    currentPathname.current = '/settings/api-keys/anything'
    render(<AdminNav />)
    const nav = screen.getByRole('navigation', { name: 'common.accessibility.settingsNav' })

    expect(within(nav).getByRole('link', { name: 'navigation.models' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(nav).getByRole('link', { name: 'navigation.general' })
    ).not.toHaveAttribute('aria-current')
    expect(
      within(nav).getByRole('link', { name: 'navigation.groups' })
    ).not.toHaveAttribute('aria-current')
    expect(
      within(nav).getByRole('link', { name: 'navigation.advanced' })
    ).not.toHaveAttribute('aria-current')
  })

  it('provides a labeled mobile subnavigation control', () => {
    currentPathname.current = '/settings/groups'
    render(<AdminNav />)

    const control = screen.getByRole('combobox', { name: 'common.accessibility.settingsNav' })
    expect(control).toBeInTheDocument()
  })
})

describe('SettingsLayout', () => {
  it('wraps AdminNav and the page content in AppShell and AdminOnly', () => {
    currentPathname.current = '/settings'
    render(
      <SettingsLayout>
        <div data-testid="page-content">content</div>
      </SettingsLayout>
    )

    const shell = screen.getByTestId('app-shell')
    const adminOnly = screen.getByTestId('admin-only')

    expect(within(shell).getByTestId('admin-only')).toBe(adminOnly)
    expect(
      within(adminOnly).getByRole('navigation', { name: 'common.accessibility.settingsNav' })
    ).toBeInTheDocument()
    expect(within(adminOnly).getByTestId('page-content')).toBeInTheDocument()
  })
})

describe('legacy /advanced route', () => {
  it('redirects to /settings/advanced', () => {
    expect(() => render(<AdvancedRedirect />)).toThrow('NEXT_REDIRECT:/settings/advanced')
    expect(redirectMock).toHaveBeenCalledWith('/settings/advanced')
  })
})
