import type { AccessSummary } from '../types/api'

/** Access roles returned on notebook/source responses (WP2b). */
export type AccessRole = 'owner' | 'editor' | 'viewer'

/** Missing role = open/auth-off mode — treat as full access. */
export function canEditContent(role?: AccessRole | null): boolean {
  return !role || role === 'owner' || role === 'editor'
}

export function canDeleteNotebook(role?: AccessRole | null): boolean {
  return !role || role === 'owner'
}

export function canDeleteSource(role?: AccessRole | null): boolean {
  return !role || role === 'owner'
}

export function canManageAcl(
  role?: AccessRole | null,
  isAdmin = false
): boolean {
  return isAdmin || !role || role === 'owner'
}

/** Human-readable explanation of *why* the user has this access (WP3-06) -
 * presentation only, alongside (not instead of) the role badge. `t` is the
 * i18next translate function; pass it in rather than importing the hook
 * here so this stays a plain, easily-testable utility. */
export function describeAccess(
  summary?: AccessSummary | null,
  t?: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!summary || !t) return ''
  switch (summary.origin) {
    case 'owner':
      return t('sharing.owner')
    case 'open':
      return t('sharing.originOpen')
    case 'direct':
      return t('sharing.originDirect')
    case 'group':
      return t('sharing.originGroup', { name: summary.origin_label ?? t('sharing.group') })
    case 'notebook':
      return t('sharing.originNotebook', { name: summary.origin_label ?? '' })
    default:
      return ''
  }
}
