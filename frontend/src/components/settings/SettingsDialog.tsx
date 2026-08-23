'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsForm } from '@/app/(dashboard)/settings/components/SettingsForm'
import { SystemInfo, RebuildEmbeddings } from '@/components/settings'
import { useTranslation } from '@/lib/hooks/use-translation'

export type SettingsTab = 'general' | 'advanced'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tab shown when the dialog opens; the dialog remounts on each open, so this re-applies. */
  defaultTab?: SettingsTab
}

/**
 * Admin settings as a modal: General (processing/embedding/file defaults) and
 * Advanced (system info + the destructive embedding rebuild) as two tabs.
 * Opened via useSettingsDialog from the sidebar user menu, the command palette,
 * and the embedding-model change flow. Models and Groups stay their own pages.
 */
export function SettingsDialog({ open, onOpenChange, defaultTab = 'general' }: SettingsDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>{t('navigation.settings')}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue={defaultTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList
            aria-label={t('common.accessibility.settingsNav')}
            className="mx-6 mt-4 w-fit"
          >
            <TabsTrigger value="general">{t('navigation.general')}</TabsTrigger>
            <TabsTrigger value="advanced">{t('navigation.advanced')}</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <TabsContent value="general" className="mt-0">
              <SettingsForm />
            </TabsContent>
            <TabsContent value="advanced" className="mt-0 space-y-6">
              <p className="text-sm text-muted-foreground">{t('advanced.desc')}</p>
              <SystemInfo />
              <RebuildEmbeddings />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
