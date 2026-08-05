import type { UserRole } from '@/lib/types/auth'

/** Open mode shows admin UI; with auth, only role=admin. */
export function canAccessAdminUi(
  authRequired: boolean | null,
  role: UserRole | null
): boolean {
  if (authRequired === false) return true
  if (authRequired !== true) return false
  return role === 'admin'
}
