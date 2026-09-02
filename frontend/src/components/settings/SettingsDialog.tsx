'use client'

import { useEffect, useState } from 'react'
import { Settings, Wrench } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SettingsForm } from '@/app/(dashboard)/settings/components/SettingsForm'
import { SystemInfo, RebuildEmbeddings } from '@/components/settings'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

export type SettingsTab = 'general' | 'advanced'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Section selected when the dialog opens. */
  defaultTab?: SettingsTab
}

// Mirrors the app sidebar's SidebarMenuButton (expanded) so the modal rail reads
// exactly like the main navigation: sidebar tokens, h-9 rows, hover/active accent.
const NAV_ITEM =
  'flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--control-radius)] px-3 text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0'
const NAV_ITEM_ACTIVE = 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'

/**
 * Admin settings as a modal with a left rail styled like the app sidebar:
 * General (processing/embedding/file defaults) and Advanced (system info + the
 * destructive embedding rebuild). Opened via useSettingsDialog from the sidebar
 * user menu, the command palette, and the embedding-model change flow. Models
 * and Groups stay their own pages.
 */
export function SettingsDialog({ open, onOpenChange, defaultTab = 'general' }: SettingsDialogProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState<SettingsTab>(defaultTab)

  // The dialog instance stays mounted, so re-select the requested section each
  // time it opens (or when a trigger changes which section to show).
  useEffect(() => {
    if (open) setActive(defaultTab)
  }, [open, defaultTab])

  const sections = [
    { id: 'general' as const, label: t('navigation.general'), icon: Settings },
    { id: 'advanced' as const, label: t('navigation.advanced'), icon: Wrench },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl sm:flex-row">
        <div className="flex shrink-0 flex-col gap-1 border-b border-sidebar-border bg-sidebar px-2 py-3 pr-12 text-sidebar-foreground sm:w-48 sm:border-b-0 sm:border-r sm:pr-2">
          <DialogTitle className="mb-1 px-3 text-xs font-semibold text-sidebar-foreground">
            {t('navigation.settings')}
          </DialogTitle>
          <nav aria-label={t('common.accessibility.settingsNav')}>
            <ul className="flex min-w-0 flex-row gap-1 sm:flex-col">
              {sections.map((section) => (
                <li key={section.id} className="relative min-w-0 flex-1 sm:flex-none">
                  <button
                    type="button"
                    aria-current={active === section.id ? 'page' : undefined}
                    onClick={() => setActive(section.id)}
                    className={cn(NAV_ITEM, active === section.id && NAV_ITEM_ACTIVE)}
                  >
                    <section.icon />
                    {section.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-6 sm:pt-12">
          {active === 'general' ? (
            <SettingsForm />
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">{t('advanced.desc')}</p>
              <SystemInfo />
              <RebuildEmbeddings />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
