import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('./SetupBanner', () => ({ SetupBanner: () => null }))

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  })

  it('exposes the responsive navigation and focusable content landmark', () => {
    render(<AppShell><p>Research workspace</p></AppShell>)

    expect(screen.getByRole('button', { name: 'common.openNavigation' })).toBeInTheDocument()
    const mobileHeader = document.querySelector('[data-slot="mobile-app-header"]')
    expect(mobileHeader).not.toBeNull()
    expect(mobileHeader).toHaveClass(
      'grid',
      'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    )
    expect(mobileHeader?.querySelector('[data-slot="sidebar-trigger"]')).toHaveClass(
      'col-start-1',
      'justify-self-start',
    )
    expect(within(mobileHeader as HTMLElement).getByRole('img', { name: 'Open Notebook' })).toBeInTheDocument()
    expect(mobileHeader?.querySelector('[data-slot="mobile-app-brand"]')).toHaveClass(
      'col-start-2',
      'justify-self-center',
    )
    expect(document.getElementById('mobile-detail-actions')).toHaveClass(
      'col-start-3',
      'justify-self-end',
    )
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(main.parentElement).toHaveClass('min-h-0', 'overflow-hidden')
  })

  it('lets desktop users expand and collapse the sidebar and remembers their choice', async () => {
    const { unmount } = render(<AppShell><p>Research workspace</p></AppShell>)

    const expandButton = await screen.findByRole('button', {
      name: 'common.expandNavigation',
    })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(expandButton)

    const collapseButton = screen.getByRole('button', {
      name: 'common.collapseNavigation',
    })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')
    expect(localStorage.getItem('open-notebook:sidebar-expanded')).toBe('true')

    unmount()
    render(<AppShell><p>Research workspace</p></AppShell>)

    const restoredCollapseButton = await screen.findByRole('button', {
      name: 'common.collapseNavigation',
    })
    expect(restoredCollapseButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(restoredCollapseButton)

    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'common.expandNavigation',
      })).toHaveAttribute('aria-expanded', 'false')
    })
    expect(localStorage.getItem('open-notebook:sidebar-expanded')).toBe('false')
  })

  it('toggles the desktop sidebar with Ctrl+B and remembers the result', async () => {
    render(<AppShell><p>Research workspace</p></AppShell>)

    await screen.findByRole('button', {
      name: 'common.expandNavigation',
    })

    fireEvent.keyDown(document, { key: 'b', ctrlKey: true })

    expect(screen.getByRole('button', {
      name: 'common.collapseNavigation',
    })).toHaveAttribute('aria-expanded', 'true')
    expect(localStorage.getItem('open-notebook:sidebar-expanded')).toBe('true')
  })

  it('preserves the standard Bold shortcut while the user is editing', async () => {
    render(
      <AppShell>
        <input aria-label="Note title" />
      </AppShell>
    )

    await screen.findByRole('button', {
      name: 'common.expandNavigation',
    })

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note title' }), {
      key: 'b',
      ctrlKey: true,
    })

    expect(screen.getByRole('button', {
      name: 'common.expandNavigation',
    })).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem('open-notebook:sidebar-expanded')).toBeNull()
  })

  it('does not change the hidden desktop preference below the sidebar breakpoint', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    render(<AppShell><p>Research workspace</p></AppShell>)

    await screen.findByRole('button', {
      name: 'common.expandNavigation',
    })

    fireEvent.keyDown(document, { key: 'b', ctrlKey: true })

    expect(screen.getByRole('button', {
      name: 'common.expandNavigation',
    })).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem('open-notebook:sidebar-expanded')).toBeNull()
  })
})
