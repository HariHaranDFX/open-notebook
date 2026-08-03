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
  const fulfilled = apiClient.interceptors.request.handlers[0].fulfilled
  const merged = mergeConfig(apiClient.defaults, { headers: {}, ...config })
  return fulfilled(merged as InternalAxiosRequestConfig)
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
