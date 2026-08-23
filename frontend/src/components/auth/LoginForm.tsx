'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { useAuthStore } from '@/lib/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { BrandLogo } from '@/components/common/BrandLogo'
import { useBrand } from '@/components/providers/BrandProvider'
import { useTranslation } from '@/lib/hooks/use-translation'

function LoginBrand() {
  const { appName } = useBrand()
  const { t } = useTranslation()

  return (
    <div className="flex min-w-0 flex-col items-center gap-3">
      <BrandLogo size={48} priority />
      <CardTitle className="max-w-full break-words text-center">
        {t('auth.loginTitle', { appName })}
      </CardTitle>
    </div>
  )
}

export function LoginForm() {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { login, isLoading, error } = useAuth()
  const {
    authRequired,
    checkAuthRequired,
    checkAuth,
    hasHydrated,
    isAuthenticated,
    provider,
  } = useAuthStore()
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const router = useRouter()
  const passwordInputRef = useRef<HTMLInputElement>(null)

  // Check if authentication is required on mount; for Entra also probe the
  // session cookie so a successful OAuth callback that soft-landed on /login
  // still continues into the app.
  useEffect(() => {
    if (!hasHydrated) {
      return
    }

    const checkAuthRequirement = async () => {
      try {
        const required = await checkAuthRequired()

        if (!required) {
          router.push('/notebooks')
          return
        }

        if (useAuthStore.getState().provider === 'entra') {
          const ok = await checkAuth()
          if (ok) {
            const redirectPath = sessionStorage.getItem('redirectAfterLogin')
            if (redirectPath) {
              sessionStorage.removeItem('redirectAfterLogin')
              router.push(redirectPath)
            } else {
              router.push('/notebooks')
            }
            return
          }
        }
      } catch (error) {
        console.error('Error checking auth requirement:', error)
        // On error, assume auth is required to be safe
      } finally {
        setIsCheckingAuth(false)
      }
    }

    // If we already know auth status, use it
    if (authRequired !== null) {
      if (!authRequired && isAuthenticated) {
        router.push('/notebooks')
        setIsCheckingAuth(false)
      } else if (authRequired && provider === 'entra') {
        void (async () => {
          try {
            const ok = await checkAuth()
            if (ok) {
              router.push('/notebooks')
              return
            }
          } finally {
            setIsCheckingAuth(false)
          }
        })()
      } else {
        setIsCheckingAuth(false)
      }
    } else {
      void checkAuthRequirement()
    }
  }, [hasHydrated, authRequired, checkAuthRequired, checkAuth, router, isAuthenticated, provider])

  // Move keyboard focus to the password field whenever a new sign-in error
  // appears, so screen reader and keyboard users land on the actionable
  // control without hunting for it. Also re-runs when the auth-check gate
  // clears: the password input doesn't exist yet on the loading render, so
  // an error present at that point (e.g. mocked/edge-case initial state)
  // would otherwise be missed since `error` itself never changes again.
  useEffect(() => {
    if (error) {
      passwordInputRef.current?.focus()
    }
  }, [error, isCheckingAuth])

  // Show loading while checking if auth is required
  if (!hasHydrated || isCheckingAuth) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <LoadingSpinner />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    )
  }

  // If we still don't know if auth is required (connection error), show error
  if (authRequired === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md" role="alert" aria-live="assertive">
          <CardHeader className="text-center">
            <CardTitle>{t('common.connectionError')}</CardTitle>
            <CardDescription>
              {t('common.unableToConnect')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-[var(--surface-radius)] bg-error-surface p-3 text-sm text-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex-1">
                  {error || t('auth.connectErrorHint')}
                </div>
              </div>

              <Button
                onClick={() => window.location.reload()}
                className="w-full"
                autoFocus
              >
                {t('common.retryConnection')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.trim()) {
      try {
        await login(password)
      } catch (error) {
        console.error('Unhandled error during login:', error)
        // The auth store should handle most errors, but this catches any unhandled ones
      }
    }
  }

  if (provider === 'entra') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <LoginBrand />
            <CardDescription>{t('auth.entraLoginDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="w-full"
              // Relative URL: must resolve through the page origin (Next
              // rewrite → FastAPI), not a cross-origin API host, so the
              // provider's Set-Cookie on callback lands as first-party.
              onClick={() => { window.location.href = '/api/auth/login' }}
            >
              {t('auth.signInWithMicrosoft')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <LoginBrand />
          <CardDescription>
            {t('auth.loginDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2 text-left">
              <Label htmlFor="login-password">{t('auth.passwordPlaceholder')}</Label>
              <div className="relative">
                <Input
                  id="login-password"
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-password-error' : undefined}
                  className="pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <div
                id="login-password-error"
                role="alert"
                aria-live="assertive"
                className="flex items-center gap-2 rounded-[var(--surface-radius)] bg-error-surface p-2 text-sm text-error"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !password.trim()}
            >
              {isLoading ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
