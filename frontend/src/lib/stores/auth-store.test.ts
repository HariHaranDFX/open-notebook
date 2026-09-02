import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  setEntraAuthMode: vi.fn(),
}))

vi.mock('@/lib/config', () => ({
  getApiUrl: vi.fn().mockResolvedValue('http://localhost:5055'),
}))

import apiClient, { setEntraAuthMode } from '@/lib/api/client'
import { useAuthStore } from './auth-store'

const mockedGet = vi.mocked(apiClient.get)
const mockedPost = vi.mocked(apiClient.post)
const mockedFetch = vi.fn()

const resetStore = () => {
  useAuthStore.setState({
    isAuthenticated: false,
    token: null,
    isLoading: false,
    error: null,
    lastAuthCheck: null,
    isCheckingAuth: false,
    provider: 'password',
    authRequired: null,
    role: null,
    user: null,
  })
}

describe('auth-store provider branching', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockedFetch)
    resetStore()
    // logout() navigates via window.location.href in Entra mode.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  describe('checkAuthRequired', () => {
    it('defaults to the password provider and does not enable Entra credentials mode', async () => {
      mockedGet.mockResolvedValueOnce({ data: { auth_enabled: true, provider: 'password' } })

      await useAuthStore.getState().checkAuthRequired()

      expect(useAuthStore.getState().provider).toBe('password')
      expect(setEntraAuthMode).toHaveBeenCalledWith(false)
    })

    it('leaves a fresh password login ready for input when no saved token exists', async () => {
      mockedGet.mockResolvedValueOnce({ data: { auth_enabled: true, provider: 'password' } })

      await useAuthStore.getState().checkAuthRequired()

      expect(useAuthStore.getState().isCheckingAuth).toBe(false)
    })

    it('switches to the entra provider and enables credentials mode', async () => {
      mockedGet.mockResolvedValueOnce({ data: { auth_enabled: true, provider: 'entra' } })

      await useAuthStore.getState().checkAuthRequired()

      expect(useAuthStore.getState().provider).toBe('entra')
      expect(setEntraAuthMode).toHaveBeenCalledWith(true)
    })

    it('treats an unrecognized provider value as password', async () => {
      mockedGet.mockResolvedValueOnce({ data: { auth_enabled: true, provider: 'saml' } })

      await useAuthStore.getState().checkAuthRequired()

      expect(useAuthStore.getState().provider).toBe('password')
    })
  })

  describe('checkAuth (entra)', () => {
    beforeEach(() => {
      useAuthStore.setState({ provider: 'entra' })
    })

    it('marks authenticated when GET /auth/me succeeds via cookie session', async () => {
      mockedGet.mockResolvedValueOnce({
        data: {
          id: 'u1',
          email: 'researcher@example.com',
          display_name: 'Researcher One',
          role: 'user',
        },
      })

      const result = await useAuthStore.getState().checkAuth()

      expect(result).toBe(true)
      expect(mockedGet).toHaveBeenCalledWith('/auth/me')
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(useAuthStore.getState().role).toBe('user')
      expect(useAuthStore.getState().user).toEqual({
        id: 'u1',
        email: 'researcher@example.com',
        displayName: 'Researcher One',
        role: 'user',
      })
    })

    it('stores admin role from /auth/me', async () => {
      mockedGet.mockResolvedValueOnce({ data: { id: 'u1', role: 'admin' } })

      await useAuthStore.getState().checkAuth()

      expect(useAuthStore.getState().role).toBe('admin')
    })

    it('marks unauthenticated when GET /auth/me rejects (no valid session cookie)', async () => {
      mockedGet.mockRejectedValueOnce(new Error('401'))

      const result = await useAuthStore.getState().checkAuth()

      expect(result).toBe(false)
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })

    it('does not fall back to the token-based password flow', async () => {
      mockedGet.mockResolvedValueOnce({ data: { id: 'u1' } })

      await useAuthStore.getState().checkAuth()

      expect(mockedGet).toHaveBeenCalledTimes(1)
      expect(mockedGet).toHaveBeenCalledWith('/auth/me')
    })

    it('marks isCheckingAuth while /auth/me is in flight', async () => {
      let resolveMe!: (value: unknown) => void
      mockedGet.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveMe = resolve
        }) as ReturnType<typeof apiClient.get>
      )

      const pending = useAuthStore.getState().checkAuth()
      expect(useAuthStore.getState().isCheckingAuth).toBe(true)

      resolveMe({ data: { id: 'u1' } })
      await pending
      expect(useAuthStore.getState().isCheckingAuth).toBe(false)
    })

    it('sets isCheckingAuth when auth is required so UI can wait before redirect', async () => {
      mockedGet.mockResolvedValueOnce({ data: { auth_enabled: true, provider: 'entra' } })

      await useAuthStore.getState().checkAuthRequired()

      expect(useAuthStore.getState().provider).toBe('entra')
      expect(useAuthStore.getState().isCheckingAuth).toBe(true)
    })
  })

  describe('persist partialization', () => {
    it('does not persist isAuthenticated (cookie/token re-check is source of truth)', () => {
      const persistOptions = (
        useAuthStore as unknown as {
          persist: { getOptions: () => { partialize: (s: unknown) => unknown } }
        }
      ).persist.getOptions()
      const partial = persistOptions.partialize({
        token: 'secret',
        isAuthenticated: true,
        provider: 'entra',
        isLoading: false,
      })
      expect(partial).toEqual({ token: 'secret' })
      expect(partial).not.toHaveProperty('isAuthenticated')
    })
  })

  describe('logout (entra)', () => {
    beforeEach(() => {
      useAuthStore.setState({ provider: 'entra', isAuthenticated: true })
    })

    it('posts to /auth/logout with credentials and redirects to /login', async () => {
      mockedPost.mockResolvedValueOnce({ data: undefined })

      await useAuthStore.getState().logout()

      expect(mockedPost).toHaveBeenCalledWith('/auth/logout')
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(window.location.href).toBe('/login')
    })

    it('still clears local state and redirects even if the logout request fails', async () => {
      mockedPost.mockRejectedValueOnce(new Error('network error'))

      await useAuthStore.getState().logout()

      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(window.location.href).toBe('/login')
    })
  })

  describe('logout (password)', () => {
    it('clears local state without calling the API', async () => {
      useAuthStore.setState({ provider: 'password', isAuthenticated: true, token: 'secret' })

      await useAuthStore.getState().logout()

      expect(mockedPost).not.toHaveBeenCalled()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(useAuthStore.getState().token).toBe(null)
    })
  })

  describe('login errors', () => {
    it('stores a translation key instead of a raw network exception', async () => {
      mockedFetch.mockRejectedValueOnce(new Error('C:\\private\\trace.txt'))

      await useAuthStore.getState().login('wrong')

      expect(useAuthStore.getState().error).toBe('auth.authenticationFailed')
    })

    it('stores the invalid-password translation key for a 401', async () => {
      mockedFetch.mockResolvedValueOnce({ ok: false, status: 401 })

      await useAuthStore.getState().login('wrong')

      expect(useAuthStore.getState().error).toBe('auth.invalidPassword')
    })
  })
})
