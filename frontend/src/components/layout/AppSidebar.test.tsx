import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BrandProvider } from '@/components/providers/BrandProvider'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'

// Mock Tooltip components to avoid Radix UI async issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children, className, side }: React.ComponentProps<'div'> & { side?: string }) => (
    <div className={className} data-side={side}>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, variant }: React.ComponentProps<'div'> & { variant?: string }) => (
    <div role="menuitem" data-variant={variant}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children, ...props }: React.ComponentProps<'div'>) => <div role="menuitem" {...props}>{children}</div>,
  DropdownMenuSubContent: ({ children, className }: React.ComponentProps<'div'>) => (
    <div data-submenu="true" className={className}>{children}</div>
  ),
}))

describe('AppSidebar', () => {
  const renderSidebar = (expanded = true, brand?: React.ComponentProps<typeof BrandProvider>['brand']) => {
    const sidebar = (
      <SidebarProvider open={expanded}>
        <AppSidebar />
      </SidebarProvider>
    )
    return render(brand ? <BrandProvider brand={brand}>{sidebar}</BrandProvider> : sidebar)
  }

  it('renders the configured deployment identity', () => {
    renderSidebar(true, {
      appName: 'Atlas Research',
      logoUrl: '/brand/atlas.svg',
      actionLight: '#275E91',
      actionDark: '#74A9D6',
    })

    expect(screen.getByText('Atlas Research')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Atlas Research' })).toBeInTheDocument()
  })

  it('renders every primary and administrative destination', () => {
    renderSidebar()

    expect(screen.getByRole('link', { name: 'navigation.sources' })).toHaveAttribute('href', '/sources')
    expect(screen.getByRole('link', { name: 'navigation.notebooks' })).toHaveAttribute('href', '/notebooks')
    expect(screen.getByRole('link', { name: 'navigation.askAndSearch' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'navigation.podcasts' })).toHaveAttribute('href', '/podcasts')
    expect(screen.getByRole('link', { name: 'navigation.transformations' })).toHaveAttribute('href', '/transformations')
    expect(screen.getByRole('link', { name: 'navigation.models' })).toHaveAttribute('href', '/settings/api-keys')
    expect(screen.getByRole('link', { name: 'navigation.groups' })).toHaveAttribute('href', '/settings/groups')
    expect(screen.getByRole('link', { name: 'navigation.advanced' })).toHaveAttribute('href', '/advanced')
  })

  it('anchors identity in the footer and moves personal controls into its menu', () => {
    renderSidebar()

    const footer = document.querySelector('[data-slot="sidebar-footer"]') as HTMLElement
    const userMenu = screen.getByRole('button', { name: /Test Researcher/ })
    const quickActions = screen.getByTestId('quick-actions-banner')

    expect(within(footer).getByRole('button', { name: /Test Researcher/ })).toBe(userMenu)
    expect(within(footer).queryByText('common.quickActions')).not.toBeInTheDocument()
    expect(quickActions.closest('[data-slot="sidebar-content"]')).toBeInTheDocument()
    expect(quickActions).toHaveClass('border', 'bg-sidebar-accent/50', 'rounded-[var(--surface-radius)]')
    expect(quickActions.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(footer).toHaveClass('py-1')
    expect(userMenu).not.toHaveClass('border')
    expect(userMenu).toHaveClass('h-12', 'px-2', 'cursor-pointer')
    expect(screen.getAllByText('test@example.com')).toHaveLength(2)
    expect(screen.getByRole('menuitem', { name: 'navigation.settings' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.theme' })).toHaveClass('gap-2', '[&>svg]:size-4')
    expect(screen.getByRole('menuitem', { name: 'navigation.language' })).toHaveClass('gap-2', '[&>svg]:size-4')
    const signOut = screen.getByRole('menuitem', { name: 'common.signOut' })
    expect(signOut).toHaveAttribute('data-variant', 'destructive')
    expect(signOut.closest('[data-side]')).toHaveAttribute('data-side', 'top')
    expect(signOut.closest('[data-side]')).toHaveClass('w-64', 'relative', 'left-2')
    expect(screen.getByText('common.light').closest('[data-submenu]')).toHaveClass('relative', '-top-2')
    expect(screen.getByText('common.english').closest('[data-submenu]')).toHaveClass('relative', '-top-2')
    expect(within(screen.getByRole('navigation')).queryByRole('link', {
      name: 'navigation.settings',
    })).not.toBeInTheDocument()
  })

  it('uses the collapsed brand slot as the accessible expand control', () => {
    renderSidebar(false)

    const expandButton = screen.getByRole('button', {
      name: 'common.expandNavigation',
    })

    expect(within(expandButton).getByTestId('brand-logo-light')).toBeInTheDocument()
    expect(expandButton).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B')
    expect(expandButton).toHaveClass('size-11')
    expect(expandButton.closest('[data-slot="sidebar-header"]')).toHaveClass('h-14')
    expect(expandButton.closest('[data-slot="sidebar-header"]')?.firstElementChild).toHaveClass('px-1')
    expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
    const navigation = screen.getByRole('navigation')
    expect(navigation).toHaveClass('px-1', 'py-2')
    expect(navigation).not.toHaveClass('sidebar-scroll-region')
    document.querySelectorAll('[data-slot="separator"]').forEach(separator => {
      expect(separator).toHaveClass('my-1')
    })
    const create = screen.getByRole('button', { name: 'common.create' })
    expect(create).toHaveClass('mx-auto', 'size-9', 'p-0')
    const sources = screen.getByRole('link', { name: 'navigation.sources' })
    expect(sources).toHaveClass('mx-auto', 'size-9', 'p-0')
    expect(sources).not.toHaveClass('w-full')
    expect(screen.getByRole('button', { name: 'Test Researcher' })).toBeInTheDocument()
  })

  it('uses the compact expanded sidebar width', () => {
    renderSidebar()

    expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')
    expect(screen.getByRole('navigation')).toHaveClass('px-2', 'py-3')
    const collapseButton = screen.getByRole('button', {
      name: 'common.collapseNavigation',
    })
    expect(collapseButton.parentElement).toHaveClass('pl-4', 'pr-2')
  })
})
