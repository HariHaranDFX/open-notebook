'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { TFunction } from 'i18next'
import { Bot, Settings, Users, Wrench } from 'lucide-react'

import { isNavItemActive } from '@/components/layout/nav-active'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

const getAdminNavItems = (t: TFunction) =>
  [
    { href: '/settings', label: t('navigation.general'), icon: Settings },
    { href: '/settings/api-keys', label: t('navigation.models'), icon: Bot },
    { href: '/settings/groups', label: t('navigation.groups'), icon: Users },
    { href: '/settings/advanced', label: t('navigation.advanced'), icon: Wrench },
  ] as const

/** Local navigation for the /settings hierarchy: a compact rail on desktop, a labeled Select on phone. */
export function AdminNav() {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const navLabel = t('common.accessibility.settingsNav')

  const items = getAdminNavItems(t)
  const hrefs = items.map((item) => item.href)
  const activeHref = items.find((item) => isNavItemActive(pathname, item.href, hrefs))?.href

  return (
    <>
      {/* Phone: labeled Select, shown above the page content. */}
      <div className="border-b border-border p-3 lg:hidden">
        <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t('navigation.settings')}
        </p>
        <Select value={activeHref} onValueChange={(value) => router.push(value)}>
          <SelectTrigger className="w-full" aria-label={navLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.href} value={item.href}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: compact local rail, shown to the left of the page content. */}
      <nav aria-label={navLabel} className="hidden w-56 shrink-0 border-r border-border p-3 lg:block">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t('navigation.settings')}
        </p>
        <ul className="space-y-1">
          {items.map((item) => {
            const isActive = item.href === activeHref
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-[var(--control-radius)] px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>svg]:size-4 [&>svg]:shrink-0',
                    isActive && 'bg-accent font-semibold text-accent-foreground'
                  )}
                >
                  <item.icon />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
