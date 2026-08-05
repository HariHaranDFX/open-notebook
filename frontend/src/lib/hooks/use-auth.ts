'use client'

import { useAuthStore } from '@/lib/stores/auth-store'
import { canAccessAdminUi } from '@/lib/auth/admin-access'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function useAuth() {
  const router = useRouter()
  const {
    isAuthenticated,
    isLoading,
    isCheckingAuth,
    login,
    logout,
    checkAuth,
    checkAuthRequired,
    error,
    hasHydrated,
    authRequired,
    provider,
    role,
  } = useAuthStore()

  useEffect(() => {
    // Only check auth after the store has hydrated from localStorage
    if (hasHydrated) {
      // First check if auth is required
      if (authRequired === null) {
        checkAuthRequired().then((required) => {
          // If auth is required, check if we have valid credentials
          if (required) {
            void checkAuth()
          }
        }).catch(() => {
          // checkAuthRequired already updated store error/flags
        })
      } else if (authRequired) {
        // Auth is required, check credentials
        void checkAuth()
      }
      // If authRequired === false, we're already authenticated (set in checkAuthRequired)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, authRequired])

  const handleLogin = async (password: string) => {
    const success = await login(password)
    if (success) {
      // Check if there's a stored redirect path
      const redirectPath = sessionStorage.getItem('redirectAfterLogin')
      if (redirectPath) {
        sessionStorage.removeItem('redirectAfterLogin')
        router.push(redirectPath)
      } else {
        router.push('/notebooks')
      }
    }
    return success
  }

  const handleLogout = async () => {
    // Entra logout navigates via window.location itself (see auth-store);
    // router.push after would race a full page unload, so only push here
    // for the password flow where logout() is synchronous local state.
    await logout()
    if (provider !== 'entra') {
      router.push('/login')
    }
  }

  // Wait for hydrate, /auth/status, and /auth/me (isCheckingAuth) before
  // treating the user as logged-out — otherwise Entra callback lands on
  // /notebooks, hydrates isAuthenticated=false, and bounces to /login.
  const bootstrapping =
    !hasHydrated || authRequired === null || isCheckingAuth

  const isAdmin = canAccessAdminUi(authRequired, role)

  return {
    isAuthenticated,
    isLoading: isLoading || bootstrapping,
    isAdmin,
    role,
    error,
    login: handleLogin,
    logout: handleLogout
  }
}
