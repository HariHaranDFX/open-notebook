import axios from 'axios'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import apiClient, { setEntraAuthMode } from '@/lib/api/client'
import { getApiUrl } from '@/lib/config'
import type { AuthProvider, AuthUser, UserRole } from '@/lib/types/auth'

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  isLoading: boolean
  error: string | null
  lastAuthCheck: number | null
  isCheckingAuth: boolean
  hasHydrated: boolean
  authRequired: boolean | null
  provider: AuthProvider
  role: UserRole | null
  user: AuthUser | null
  setHasHydrated: (state: boolean) => void
  checkAuthRequired: () => Promise<boolean>
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
  checkAuth: () => Promise<boolean>
}

function roleFromMe(data: unknown): UserRole {
  if (
    data &&
    typeof data === 'object' &&
    'role' in data &&
    (data as { role: unknown }).role === 'admin'
  ) {
    return 'admin'
  }
  return 'user'
}

function userFromMe(data: unknown): AuthUser | null {
  if (!data || typeof data !== 'object') return null

  const user = data as Record<string, unknown>
  if (
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    typeof user.display_name !== 'string'
  ) return null

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role === 'admin' ? 'admin' : 'user',
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      token: null,
      isLoading: false,
      error: null,
      lastAuthCheck: null,
      isCheckingAuth: false,
      hasHydrated: false,
      authRequired: null,
      provider: 'password',
      role: null,
      user: null,

      setHasHydrated: (state: boolean) => {
        set({ hasHydrated: state })
      },

      checkAuthRequired: async () => {
        try {
          const response = await apiClient.get<{ auth_enabled?: boolean; provider?: AuthProvider }>('/auth/status', {
            headers: { 'Cache-Control': 'no-store' },
          })

          const required = response.data.auth_enabled || false
          const provider: AuthProvider = response.data.provider === 'entra' ? 'entra' : 'password'
          setEntraAuthMode(provider === 'entra')
          // When auth is required, mark checking immediately so the dashboard
          // does not redirect to /login before checkAuth() finishes (/auth/me).
          set({
            authRequired: required,
            provider,
            isCheckingAuth: required,
          })

          // If auth is not required, mark as authenticated
          if (!required) {
            set({
              isAuthenticated: true,
              token: 'not-required',
              isCheckingAuth: false,
              role: 'admin',
              user: {
                id: 'local',
                email: 'local@dev',
                displayName: 'Local Admin',
                role: 'admin',
              },
            })
          }

          return required
        } catch (error) {
          console.error('Failed to check auth status:', error)

          // If it's a network error, set a more helpful error message
          if (axios.isAxiosError(error) && !error.response) {
            set({
              error: 'Unable to connect to server. Please check if the API is running.',
              authRequired: null,  // Don't assume auth is required if we can't connect
              isCheckingAuth: false,
            })
          } else {
            // For other errors, default to requiring auth to be safe
            set({ authRequired: true, isCheckingAuth: true })
          }

          // Re-throw the error so the UI can handle it
          throw error
        }
      },

      login: async (password: string) => {
        set({ isLoading: true, error: null })
        try {
          const apiUrl = await getApiUrl()

          // Deliberately raw fetch (not apiClient): this probes a candidate
          // password, so the interceptors must not overwrite the Authorization
          // header with the stored token or hard-redirect on 401.
          const response = await fetch(`${apiUrl}/api/notebooks`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${password}`,
              'Content-Type': 'application/json'
            }
          })
          
          if (response.ok) {
            set({ 
              isAuthenticated: true, 
              token: password, 
              isLoading: false,
              lastAuthCheck: Date.now(),
              error: null,
              // Password provider always elevates to admin (see api/auth/password.py).
              role: 'admin',
              user: {
                id: 'local',
                email: 'local@dev',
                displayName: 'Local Admin',
                role: 'admin',
              },
            })
            return true
          } else {
            let errorMessage = 'Authentication failed'
            if (response.status === 401) {
              errorMessage = 'Invalid password. Please try again.'
            } else if (response.status === 403) {
              errorMessage = 'Access denied. Please check your credentials.'
            } else if (response.status >= 500) {
              errorMessage = 'Server error. Please try again later.'
            } else {
              errorMessage = `Authentication failed (${response.status})`
            }
            
            set({ 
              error: errorMessage,
              isLoading: false,
              isAuthenticated: false,
              token: null,
              role: null,
              user: null,
            })
            return false
          }
        } catch (error) {
          console.error('Network error during auth:', error)
          let errorMessage = 'Authentication failed'
          
          if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            errorMessage = 'Unable to connect to server. Please check if the API is running.'
          } else if (error instanceof Error) {
            errorMessage = `Network error: ${error.message}`
          } else {
            errorMessage = 'An unexpected error occurred during authentication'
          }
          
          set({ 
            error: errorMessage,
            isLoading: false,
            isAuthenticated: false,
            token: null,
            role: null,
            user: null,
          })
          return false
        }
      },
      
      logout: async () => {
        const { provider } = get()

        if (provider === 'entra') {
          try {
            // apiClient carries withCredentials for Entra mode and resolves
            // baseURL through the same-origin Next rewrite (see client.ts),
            // so the session cookie's Origin matches — safe to POST here.
            await apiClient.post('/auth/logout')
          } catch (error) {
            console.error('Entra logout request failed:', error)
          }
          set({
            isAuthenticated: false,
            token: null,
            error: null,
            lastAuthCheck: null,
            isCheckingAuth: false,
            role: null,
            user: null,
          })
          if (typeof window !== 'undefined') {
            window.location.href = '/login'
          }
          return
        }

        set({
          isAuthenticated: false,
          token: null,
          error: null,
          lastAuthCheck: null,
          role: null,
          user: null,
        })
      },
      
      checkAuth: async () => {
        const state = get()
        const { token, lastAuthCheck, isAuthenticated, provider } = state

        if (provider === 'entra') {
          const now = Date.now()
          if (isAuthenticated && lastAuthCheck && (now - lastAuthCheck) < 30000) {
            set({ isCheckingAuth: false })
            return true
          }

          set({ isCheckingAuth: true })
          try {
            // Cookie-session check: apiClient sends the session cookie via
            // withCredentials, no bearer token involved.
            const response = await apiClient.get('/auth/me')
            const user = userFromMe(response.data)
            set({
              isAuthenticated: true,
              lastAuthCheck: now,
              isCheckingAuth: false,
              role: roleFromMe(response.data),
              user,
            })
            return true
          } catch (error) {
            console.error('Entra checkAuth error:', error)
            set({
              isAuthenticated: false,
              lastAuthCheck: null,
              isCheckingAuth: false,
              role: null,
              user: null,
            })
            return false
          }
        }

        // If no token, not authenticated
        if (!token) {
          set({ isCheckingAuth: false })
          return false
        }

        // If we checked recently (within 30 seconds) and are authenticated, skip
        const now = Date.now()
        if (isAuthenticated && lastAuthCheck && (now - lastAuthCheck) < 30000) {
          set({ isCheckingAuth: false })
          return true
        }

        set({ isCheckingAuth: true })

        try {
          const apiUrl = await getApiUrl()

          // Deliberately raw fetch (not apiClient): a 401 here must update
          // store state, not trigger the interceptor's storage-clear/redirect.
          const response = await fetch(`${apiUrl}/api/notebooks`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          })
          
          if (response.ok) {
            set({ 
              isAuthenticated: true, 
              lastAuthCheck: now,
              isCheckingAuth: false,
              role: 'admin',
              user: {
                id: 'local',
                email: 'local@dev',
                displayName: 'Local Admin',
                role: 'admin',
              },
            })
            return true
          } else {
            set({
              isAuthenticated: false,
              token: null,
              lastAuthCheck: null,
              isCheckingAuth: false,
              role: null,
              user: null,
            })
            return false
          }
        } catch (error) {
          console.error('checkAuth error:', error)
          set({ 
            isAuthenticated: false, 
            token: null,
            lastAuthCheck: null,
            isCheckingAuth: false,
            role: null,
            user: null,
          })
          return false
        }
      }
    }),
    {
      name: 'auth-storage',
      // Persist only the password token. isAuthenticated must not be restored
      // from localStorage — for Entra the httpOnly cookie is the source of
      // truth, and a stale false/true flag races the dashboard into /login.
      partialize: (state) => ({
        token: state.token,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      }
    }
  )
)
