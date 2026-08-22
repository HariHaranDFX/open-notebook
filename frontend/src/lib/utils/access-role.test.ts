import { describe, it, expect } from 'vitest'
import {
  canEditContent,
  canDeleteNotebook,
  canDeleteSource,
  canManageAcl,
  describeAccess,
} from './access-role'
import type { AccessSummary } from '../types/api'

describe('access-role helpers', () => {
  it('treats missing role as full access (auth open mode)', () => {
    expect(canEditContent(undefined)).toBe(true)
    expect(canDeleteNotebook(undefined)).toBe(true)
    expect(canDeleteSource(undefined)).toBe(true)
  })

  it('gates viewer as read-only for mutations', () => {
    expect(canEditContent('viewer')).toBe(false)
    expect(canDeleteNotebook('viewer')).toBe(false)
    expect(canDeleteSource('viewer')).toBe(false)
  })

  it('allows editor content edits but not source/notebook delete', () => {
    expect(canEditContent('editor')).toBe(true)
    expect(canDeleteNotebook('editor')).toBe(false)
    expect(canDeleteSource('editor')).toBe(false)
  })

  it('allows owner full control', () => {
    expect(canEditContent('owner')).toBe(true)
    expect(canDeleteNotebook('owner')).toBe(true)
    expect(canDeleteSource('owner')).toBe(true)
  })

  it('allows ACL manage for owner or admin', () => {
    expect(canManageAcl('owner', false)).toBe(true)
    expect(canManageAcl('editor', true)).toBe(true)
    expect(canManageAcl('viewer', false)).toBe(false)
    expect(canManageAcl(undefined, true)).toBe(true)
  })
})

describe('describeAccess', () => {
  // Minimal i18next-like stub: returns the key, appending interpolated
  // values so tests can assert exactly what was passed to t().
  const t = (key: string, options?: Record<string, unknown>) =>
    options && 'name' in options ? `${key}:${String(options.name)}` : key

  it('returns an empty string when there is no summary or no t()', () => {
    expect(describeAccess(null, t)).toBe('')
    expect(describeAccess(undefined, t)).toBe('')
    expect(describeAccess({ role: 'owner', origin: 'owner' })).toBe('')
  })

  it('reuses the existing role label for owner origin', () => {
    expect(describeAccess({ role: 'owner', origin: 'owner' }, t)).toBe('sharing.owner')
  })

  it('describes open origin (auth disabled)', () => {
    expect(describeAccess({ role: 'owner', origin: 'open' }, t)).toBe('sharing.originOpen')
  })

  it('describes a direct user grant', () => {
    expect(describeAccess({ role: 'viewer', origin: 'direct' }, t)).toBe(
      'sharing.originDirect'
    )
  })

  it('describes a group grant with the group name interpolated', () => {
    const summary: AccessSummary = {
      role: 'editor',
      origin: 'group',
      origin_label: 'Engineering',
    }
    expect(describeAccess(summary, t)).toBe('sharing.originGroup:Engineering')
  })

  it('falls back to the generic group label when origin_label is missing', () => {
    expect(describeAccess({ role: 'editor', origin: 'group' }, t)).toBe(
      'sharing.originGroup:sharing.group'
    )
  })

  it('describes access inherited from a linked notebook', () => {
    const summary: AccessSummary = {
      role: 'editor',
      origin: 'notebook',
      origin_label: 'Research',
    }
    expect(describeAccess(summary, t)).toBe('sharing.originNotebook:Research')
  })
})
