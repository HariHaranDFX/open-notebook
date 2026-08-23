import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { BrandProvider } from '@/components/providers/BrandProvider'
import { LoginForm } from './LoginForm'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { appName?: string }) => options?.appName ?? key,
    language: 'en-US',
  }),
}))

// The global test/setup.ts stub for use-auth exposes only logout/isAdmin —
// LoginForm needs the real login/error/isLoading behavior driven by the
// mocked auth store below, so this file uses the actual hook instead.
vi.unmock('@/lib/hooks/use-auth')

// LoginForm must not import config/network diagnostics at all after Task 6 —
// mocking the module to a rejecting promise means the test fails loudly if
// that import (and the network call it makes) ever comes back.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => Promise.reject(new Error('LoginForm must not call getConfig'))),
}))

interface MockAuthState {
  authRequired: boolean | null
  checkAuthRequired: ReturnType<typeof vi.fn>
  checkAuth: ReturnType<typeof vi.fn>
  hasHydrated: boolean
  isAuthenticated: boolean
  provider: 'password' | 'entra'
  isLoading: boolean
  isCheckingAuth: boolean
  error: string | null
  login: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
  role: string | null
  user: unknown
}

// vi.mock factories are hoisted above this file's other module-level code, so
// the mutable state they close over must come from vi.hoisted() — a plain
// outer `let` is not visible to the factory at hoist time.
const mockAuthState = vi.hoisted(() => ({ current: undefined as unknown as MockAuthState }))

vi.mock('@/lib/stores/auth-store', () => {
  const useAuthStore = Object.assign(
    (selector?: (s: MockAuthState) => unknown) =>
      typeof selector === 'function' ? selector(mockAuthState.current) : mockAuthState.current,
    { getState: () => mockAuthState.current }
  )
  return { useAuthStore }
})

function resetState(overrides: Partial<MockAuthState> = {}) {
  mockAuthState.current = {
    authRequired: true,
    checkAuthRequired: vi.fn().mockResolvedValue(true),
    checkAuth: vi.fn().mockResolvedValue(false),
    hasHydrated: true,
    isAuthenticated: false,
    provider: 'password',
    isLoading: false,
    isCheckingAuth: false,
    error: null,
    login: vi.fn().mockResolvedValue(true),
    logout: vi.fn(),
    role: null,
    user: null,
    ...overrides,
  }
}

function renderLoginForm() {
  return render(
    <BrandProvider brand={{
      appName: 'Atlas Research',
      logoUrl: '/brand/atlas.svg',
      actionLight: '#275E91',
      actionDark: '#74A9D6',
    }}>
      <LoginForm />
    </BrandProvider>
  )
}

describe('LoginForm', () => {
  beforeEach(() => {
    mockPush.mockClear()
    sessionStorage.clear()
    resetState()
  })

  it('renders the configured deployment identity', async () => {
    renderLoginForm()

    expect(await screen.findByText('Atlas Research')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Atlas Research' })).toBeInTheDocument()
  })

  it('renders a visible label associated with the password field', () => {
    renderLoginForm()

    const input = screen.getByLabelText('auth.passwordPlaceholder')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('sets safe autocomplete on the password field', () => {
    renderLoginForm()

    expect(screen.getByLabelText('auth.passwordPlaceholder')).toHaveAttribute(
      'autocomplete',
      'current-password'
    )
  })

  it('toggles password visibility', () => {
    renderLoginForm()

    const input = screen.getByLabelText('auth.passwordPlaceholder') as HTMLInputElement
    expect(input.type).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: 'auth.showPassword' }))
    expect(input.type).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: 'auth.hidePassword' }))
    expect(input.type).toBe('password')
  })

  it('submits the password and calls login', async () => {
    renderLoginForm()

    fireEvent.change(screen.getByLabelText('auth.passwordPlaceholder'), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))

    await waitFor(() => expect(mockAuthState.current.login).toHaveBeenCalledWith('hunter2'))
  })

  it('restores the intended destination after a successful login', async () => {
    sessionStorage.setItem('redirectAfterLogin', '/notebooks/abc123')
    renderLoginForm()

    fireEvent.change(screen.getByLabelText('auth.passwordPlaceholder'), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'auth.signIn' }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/notebooks/abc123'))
    expect(sessionStorage.getItem('redirectAfterLogin')).toBeNull()
  })

  it('renders the Microsoft sign-in action for the Entra provider', async () => {
    resetState({ provider: 'entra' })
    renderLoginForm()

    expect(
      await screen.findByRole('button', { name: 'auth.signInWithMicrosoft' })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('auth.passwordPlaceholder')).not.toBeInTheDocument()
  })

  it('moves keyboard focus to the password field when a sign-in error appears', () => {
    resetState({ error: 'Invalid password. Please try again.' })
    renderLoginForm()

    expect(screen.getByLabelText('auth.passwordPlaceholder')).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid password. Please try again.')
  })

  describe('connection error state', () => {
    beforeEach(() => {
      // authRequired stays null forever in this mock (nothing mutates the
      // fake store), so once the async checkAuthRequirement() effect
      // settles, LoginForm is stuck on the "connection unknown" branch —
      // exactly the state a real broken connection produces.
      resetState({ authRequired: null, error: null })
    })

    it('offers a retry action and focuses it', async () => {
      renderLoginForm()

      const retryButton = await screen.findByRole('button', { name: 'common.retryConnection' })
      expect(retryButton).toHaveFocus()
    })

    it('announces the error in an assertive live region', async () => {
      renderLoginForm()

      expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    it('reloads the page on retry', async () => {
      const originalLocation = window.location
      const reload = vi.fn()
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, reload },
      })

      renderLoginForm()
      fireEvent.click(await screen.findByRole('button', { name: 'common.retryConnection' }))
      expect(reload).toHaveBeenCalled()

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    })

    it('never renders an API or frontend URL, and never mentions the console', async () => {
      const { container } = renderLoginForm()

      await screen.findByRole('button', { name: 'common.retryConnection' })
      expect(container.textContent).not.toMatch(/https?:\/\//i)
      expect(container.textContent).not.toMatch(/localhost/i)
      expect(container.textContent).not.toMatch(/console/i)
    })
  })

  it('never renders diagnostic build/version/API details on the password screen', () => {
    const { container } = renderLoginForm()

    expect(container.textContent).not.toMatch(/https?:\/\//i)
    expect(container.textContent).not.toMatch(/console/i)
    expect(screen.queryByText(/diagnostic/i)).not.toBeInTheDocument()
  })
})
