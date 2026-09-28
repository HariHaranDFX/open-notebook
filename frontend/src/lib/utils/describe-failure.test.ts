import { describe, expect, it } from 'vitest'

import { describeFailure } from '@/lib/utils/describe-failure'

const t = (key: string) => key

const providerDump =
  "503 UNAVAILABLE. {'code': 503, 'message': 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', 'status': 'UNAVAILABLE'}"

describe('describeFailure', () => {
  it('shows the provider sentence and drops the status envelope', () => {
    expect(describeFailure(providerDump, t)).toBe(
      'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
    )
  })

  it('keeps a short sentence that is already written for a person', () => {
    expect(describeFailure('The model timed out', t)).toBe('The model timed out')
    expect(
      describeFailure('This Office file is password-protected. Remove the password and re-upload.', t),
    ).toBe('This Office file is password-protected. Remove the password and re-upload.')
  })

  it('replaces a missing model id with a description', () => {
    expect(describeFailure('NotFoundError: Model with id model:k7w32fi49onpzn8d4p1d not found', t)).toBe(
      'apiErrors.modelUnavailable',
    )
  })

  it('replaces a traceback with a short description', () => {
    expect(describeFailure('Traceback (most recent call last):\n  File "/app/x.py", line 1', t)).toBe(
      'apiErrors.genericError',
    )
  })

  it('returns null for an empty message', () => {
    expect(describeFailure('  ', t)).toBeNull()
    expect(describeFailure(null, t)).toBeNull()
  })
})
