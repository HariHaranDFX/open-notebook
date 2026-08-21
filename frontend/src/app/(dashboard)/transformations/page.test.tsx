import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TransformationsPage from './page'

const push = vi.hoisted(() => vi.fn())
const searchParamsString = vi.hoisted(() => ({ current: '' }))
const authState = vi.hoisted(() => ({ isAdmin: true }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/transformations',
  useSearchParams: () => new URLSearchParams(searchParamsString.current),
}))

vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({ isAdmin: authState.isAdmin }),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('./components/DefaultPromptEditor', () => ({
  DefaultPromptEditor: () => <p>Default prompt editor</p>,
}))

const sampleTransformation = { id: 'transformation:1', name: 'summarize', title: 'Summarize' }

vi.mock('@/lib/hooks/use-transformations', () => ({
  useTransformations: () => ({ data: [sampleTransformation], isLoading: false, refetch: vi.fn() }),
}))

vi.mock('./components/TransformationsList', () => ({
  TransformationsList: ({ onPlayground }: { onPlayground?: (t: typeof sampleTransformation) => void }) => (
    <div>
      <p>Library view</p>
      <button onClick={() => onPlayground?.(sampleTransformation)}>Select first</button>
    </div>
  ),
}))

vi.mock('./components/TransformationPlayground', () => ({
  TransformationPlayground: ({
    selectedTransformationId,
    onBackToLibrary,
  }: {
    selectedTransformationId?: string
    onBackToLibrary?: () => void
  }) => (
    <div>
      <p>Playground view</p>
      <p>Selected: {selectedTransformationId ?? 'none'}</p>
      <button onClick={onBackToLibrary}>Back to library</button>
    </div>
  ),
}))

describe('TransformationsPage', () => {
  beforeEach(() => {
    push.mockReset()
    searchParamsString.current = ''
    authState.isAdmin = true
  })

  it('defaults to the library view when no ?view= param is present', () => {
    render(<TransformationsPage />)

    expect(screen.getByText('Library view')).toBeInTheDocument()
    expect(screen.queryByText('Playground view')).not.toBeInTheDocument()
  })

  it('falls back to library for an invalid ?view= value', () => {
    searchParamsString.current = 'view=bogus'

    render(<TransformationsPage />)

    expect(screen.getByText('Library view')).toBeInTheDocument()
  })

  it('reads the playground view and selected transformation id from the URL', () => {
    searchParamsString.current = 'view=playground&transformation=transformation%3A1'

    render(<TransformationsPage />)

    expect(screen.getByText('Playground view')).toBeInTheDocument()
    expect(screen.getByText('Selected: transformation:1')).toBeInTheDocument()
  })

  it('writes both view=playground and the encoded transformation id on row selection', () => {
    render(<TransformationsPage />)

    fireEvent.click(screen.getByText('Select first'))

    expect(push).toHaveBeenCalledWith(
      '/transformations?view=playground&transformation=transformation%3A1',
      { scroll: false }
    )
  })

  it('switching to the library tab clears a stale transformation param', () => {
    searchParamsString.current = 'view=playground&transformation=transformation%3A1'

    render(<TransformationsPage />)

    fireEvent.mouseDown(screen.getByRole('tab', { name: /transformations.title/ }), {
      button: 0,
      ctrlKey: false,
    })

    expect(push).toHaveBeenCalledWith('/transformations?view=library', { scroll: false })
  })

  it('back to library clears the transformation param but preserves unrelated params', () => {
    searchParamsString.current = 'view=playground&transformation=transformation%3A1&foo=bar'

    render(<TransformationsPage />)

    fireEvent.click(screen.getByText('Back to library'))

    expect(push).toHaveBeenCalledWith('/transformations?view=library&foo=bar', { scroll: false })
  })

  it('shows the admin-only default prompt editor for admins', () => {
    render(<TransformationsPage />)

    expect(screen.getByText('Default prompt editor')).toBeInTheDocument()
  })

  it('hides the default prompt editor for non-admins', () => {
    authState.isAdmin = false

    render(<TransformationsPage />)

    expect(screen.queryByText('Default prompt editor')).not.toBeInTheDocument()
  })
})
