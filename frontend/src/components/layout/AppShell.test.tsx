import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('./SetupBanner', () => ({ SetupBanner: () => null }))

describe('AppShell', () => {
  it('exposes the responsive navigation and focusable content landmark', () => {
    render(<AppShell><p>Research workspace</p></AppShell>)

    expect(screen.getByRole('button', { name: 'common.openNavigation' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
  })
})
