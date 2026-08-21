import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PodcastsPage from './page'

const push = vi.hoisted(() => vi.fn())
const searchParamsString = vi.hoisted(() => ({ current: '' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/podcasts',
  useSearchParams: () => new URLSearchParams(searchParamsString.current),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/components/podcasts/EpisodesTab', () => ({
  EpisodesTab: () => <p>Episodes view</p>,
}))

vi.mock('@/components/podcasts/TemplatesTab', () => ({
  TemplatesTab: () => (
    <div>
      <p>Templates view</p>
      <button type="button">podcasts.createProfile</button>
    </div>
  ),
}))

vi.mock('@/lib/hooks/use-podcasts', () => ({
  useEpisodeProfiles: () => ({ episodeProfiles: [] }),
  useSpeakerProfiles: () => ({ speakerProfiles: [] }),
}))

describe('PodcastsPage', () => {
  beforeEach(() => {
    push.mockReset()
    searchParamsString.current = ''
  })

  it('defaults to the episodes view when no ?view= param is present', () => {
    render(<PodcastsPage />)

    expect(screen.getByText('Episodes view')).toBeInTheDocument()
    expect(screen.queryByText('Templates view')).not.toBeInTheDocument()
  })

  it('falls back to episodes for an invalid ?view= value', () => {
    searchParamsString.current = 'view=bogus'

    render(<PodcastsPage />)

    expect(screen.getByText('Episodes view')).toBeInTheDocument()
  })

  it('reads the templates view from the URL', () => {
    searchParamsString.current = 'view=templates'

    render(<PodcastsPage />)

    expect(screen.getByText('Templates view')).toBeInTheDocument()
    expect(screen.getByText('podcasts.createProfile')).toBeInTheDocument()
  })

  it('writes the view into the URL on tab change, preserving other params', () => {
    searchParamsString.current = 'foo=bar'

    render(<PodcastsPage />)

    fireEvent.mouseDown(screen.getByRole('tab', { name: /podcasts.templatesTab/ }), {
      button: 0,
      ctrlKey: false,
    })

    expect(push).toHaveBeenCalledWith('/podcasts?foo=bar&view=templates', { scroll: false })
  })
})
