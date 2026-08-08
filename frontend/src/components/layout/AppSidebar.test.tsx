import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BrandProvider } from '@/components/providers/BrandProvider'
import { AppSidebar } from './AppSidebar'

// Mock Tooltip components to avoid Radix UI async issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('AppSidebar', () => {
  it('renders the configured deployment identity', () => {
    render(
      <BrandProvider brand={{
        appName: 'Atlas Research',
        logoUrl: '/brand/atlas.svg',
        actionLight: '#275E91',
        actionDark: '#74A9D6',
      }}>
        <AppSidebar mode="drawer" />
      </BrandProvider>
    )

    expect(screen.getByText('Atlas Research')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Atlas Research' })).toBeInTheDocument()
  })

  it('renders every primary and administrative destination', () => {
    render(<AppSidebar />)

    expect(screen.getByRole('link', { name: 'navigation.sources' })).toHaveAttribute('href', '/sources')
    expect(screen.getByRole('link', { name: 'navigation.notebooks' })).toHaveAttribute('href', '/notebooks')
    expect(screen.getByRole('link', { name: 'navigation.askAndSearch' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'navigation.podcasts' })).toHaveAttribute('href', '/podcasts')
    expect(screen.getByRole('link', { name: 'navigation.transformations' })).toHaveAttribute('href', '/transformations')
    expect(screen.getByRole('link', { name: 'navigation.models' })).toHaveAttribute('href', '/settings/api-keys')
    expect(screen.getByRole('link', { name: 'navigation.groups' })).toHaveAttribute('href', '/settings/groups')
    expect(screen.getByRole('link', { name: 'navigation.settings' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('link', { name: 'navigation.advanced' })).toHaveAttribute('href', '/advanced')
  })
})
