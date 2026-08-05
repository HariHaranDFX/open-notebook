import { describe, it, expect } from 'vitest'
import {
  canEditContent,
  canDeleteNotebook,
  canDeleteSource,
  canManageAcl,
} from './access-role'

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
