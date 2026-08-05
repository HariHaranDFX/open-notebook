import { AxiosError } from 'axios'
import { describe, expect, it } from 'vitest'
import { ERROR_MAP, getApiErrorKey, getApiErrorMessage } from './error-handler'

function axiosError(status: number, detail: string) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    undefined,
    undefined,
    {
      status,
      statusText: 'Error',
      headers: {},
      config: {} as never,
      data: { detail },
    }
  )
}

describe('getApiErrorMessage permission mapping', () => {
  const t = (key: string) => `t:${key}`

  it('maps admin-required detail', () => {
    expect(
      getApiErrorMessage(
        axiosError(403, 'Administrator access is required for this action'),
        t
      )
    ).toBe('t:apiErrors.adminRequired')
  })

  it('maps transformation shared-edit detail', () => {
    expect(
      getApiErrorMessage(
        axiosError(403, 'Only an administrator can edit shared transformations'),
        t
      )
    ).toBe('t:apiErrors.transformationEditShared')
  })

  it('maps default prompt admin detail', () => {
    expect(
      getApiErrorMessage(
        axiosError(
          403,
          'Only an administrator can edit the default transformation prompt'
        ),
        t
      )
    ).toBe('t:apiErrors.transformationDefaultPromptAdmin')
  })

  it('falls back to forbidden for unmapped 403', () => {
    expect(getApiErrorMessage(axiosError(403, 'Mystery deny'), t)).toBe(
      't:apiErrors.forbidden'
    )
  })

  it('getApiErrorKey uses key fallback not translated Error', () => {
    expect(getApiErrorKey(axiosError(403, 'Mystery deny'), 'apiErrors.forbidden')).toBe(
      'apiErrors.forbidden'
    )
  })

  it('keeps mapped permission keys in ERROR_MAP', () => {
    expect(ERROR_MAP['Administrator access is required for this action']).toBe(
      'apiErrors.adminRequired'
    )
  })
})
