import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BrandProvider } from '@/components/providers/BrandProvider'
import { LoginForm } from './LoginForm'

vi.mock('@/lib/config', () => ({ getConfig: vi.fn(() => new Promise(() => {})) }))

vi.mock('@/lib/stores/auth-store', () => {
  const state = {
    authRequired: true,
    checkAuthRequired: vi.fn(),
    checkAuth: vi.fn(),
    hasHydrated: true,
    isAuthenticated: false,
    provider: 'password',
  }
  const useAuthStore = Object.assign(vi.fn(() => state), { getState: () => state })
  return { useAuthStore }
})

describe('LoginForm', () => {
  it('renders the configured deployment identity', async () => {
    render(
      <BrandProvider brand={{
        appName: 'Atlas Research',
        logoUrl: '/brand/atlas.svg',
        actionLight: '#275E91',
        actionDark: '#74A9D6',
      }}>
        <LoginForm />
      </BrandProvider>
    )

    expect(await screen.findByText('Atlas Research')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Atlas Research' })).toBeInTheDocument()
  })
})
