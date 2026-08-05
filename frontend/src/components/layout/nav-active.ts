/** Longest matching nav href wins (avoids /settings lighting up on /settings/api-keys). */
export function isNavItemActive(
  pathname: string | null | undefined,
  href: string,
  allHrefs: readonly string[]
): boolean {
  if (!pathname) return false

  const matches = allHrefs.filter(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`)
  )
  if (matches.length === 0) return false

  const best = matches.reduce((a, b) => (a.length >= b.length ? a : b))
  return best === href
}
