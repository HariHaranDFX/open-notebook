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
