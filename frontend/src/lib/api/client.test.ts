import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import mergeConfig from 'axios/unsafe/core/mergeConfig.js'

vi.mock('@/lib/config', () => ({
  getApiUrl: vi.fn(async () => ''),
}))

vi.mock('@/lib/auth-token', () => ({
  getAuthToken: vi.fn(),
}))

import { apiClient, setEntraAuthMode } from './client'
import { getAuthToken } from '@/lib/auth-token'

// The request interceptor lives on the shared axios instance; invoking it
// directly (rather than firing a real network request) is the standard way
// to unit-test axios interceptor logic without a mock adapter. Axios merges
// `defaults` into `config` (see Axios.prototype.request) before the
// interceptor chain runs, so we replicate that merge here — otherwise
// `config.withCredentials` would never reflect setEntraAuthMode().
const runRequestInterceptor = (config: Partial<InternalAxiosRequestConfig>) => {
  // axios's `.handlers` array is typed possibly-undefined since v1.7. The
  // interceptor was registered by apiClient's own module init, so [0] is
  // always present here; the guards are for tsc, not the runtime.
  const handlers = (apiClient.interceptors.request as { handlers?: Array<{ fulfilled?: (c: InternalAxiosRequestConfig) => Promise<InternalAxiosRequestConfig> }> }).handlers
  const fulfilled = handlers?.[0]?.fulfilled
  if (!fulfilled) throw new Error('request interceptor missing')
  const merged = mergeConfig(apiClient.defaults, { headers: {}, ...config }) as InternalAxiosRequestConfig
  return fulfilled(merged)
}

describe('apiClient auth mode branching', () => {
  afterEach(() => {
    setEntraAuthMode(false)
  })

  beforeEach(() => {
    vi.mocked(getAuthToken).mockReset().mockReturnValue('stored-password-token')
  })

  it('attaches a Bearer token from localStorage in password mode', async () => {
    setEntraAuthMode(false)

    const config = await runRequestInterceptor({ baseURL: '/api' })

    expect(config.headers.Authorization).toBe('Bearer stored-password-token')
    expect(config.withCredentials).not.toBe(true)
  })

  it('does not attach a Bearer token in Entra mode, and sends credentials instead', async () => {
    setEntraAuthMode(true)

    const config = await runRequestInterceptor({ baseURL: '/api' })

    expect(config.headers.Authorization).toBeUndefined()
    expect(config.withCredentials).toBe(true)
    expect(getAuthToken).not.toHaveBeenCalled()
  })

  it('resolves baseURL from getApiUrl only when not already set', async () => {
    const configWithBase = await runRequestInterceptor({ baseURL: 'http://preset' })
    expect(configWithBase.baseURL).toBe('http://preset')

    const configWithoutBase = await runRequestInterceptor({})
    expect(configWithoutBase.baseURL).toBe('/api')
  })
})

describe('apiClient 401 response interceptor', () => {
  const originalLocation = window.location
  let rejected: (error: unknown) => unknown

  beforeEach(() => {
    const handlers = (apiClient.interceptors.response as { handlers?: Array<{ rejected?: (e: unknown) => unknown }> }).handlers
    const handlerRejected = handlers?.[0]?.rejected
    if (!handlerRejected) throw new Error('response interceptor missing')
    rejected = handlerRejected
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname: '/notebooks', href: 'http://localhost:3000/notebooks' },
    })
    localStorage.clear()
    localStorage.setItem('auth-storage', '{"state":{"isAuthenticated":true}}')
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    localStorage.clear()
  })

  it('does not hard-redirect on 401 from /auth/me (session probe)', async () => {
    const hrefSetter = vi.fn()
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      get: () => 'http://localhost:3000/notebooks',
      set: hrefSetter,
    })

    await expect(
      rejected({
        response: { status: 401 },
        config: { url: '/auth/me' },
      })
    ).rejects.toBeTruthy()

    expect(hrefSetter).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth-storage')).toBeTruthy()
  })

  it('does not hard-redirect when already on /login', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/login', href: 'http://localhost:3000/login' },
    })
    const hrefSetter = vi.fn()
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      get: () => 'http://localhost:3000/login',
      set: hrefSetter,
    })

    await expect(
      rejected({
        response: { status: 401 },
        config: { url: '/notebooks' },
      })
    ).rejects.toBeTruthy()

    expect(hrefSetter).not.toHaveBeenCalled()
  })

  it('clears storage and redirects to /login on 401 from a normal API call', async () => {
    let href = 'http://localhost:3000/notebooks'
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        pathname: '/notebooks',
        get href() {
          return href
        },
        set href(v: string) {
          href = v
        },
      },
    })

    await expect(
      rejected({
        response: { status: 401 },
        config: { url: '/notebooks' },
      })
    ).rejects.toBeTruthy()

    expect(localStorage.getItem('auth-storage')).toBeNull()
    expect(href).toBe('/login')
  })
})
