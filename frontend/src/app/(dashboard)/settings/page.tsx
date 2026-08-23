'use client'

import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { SettingsForm } from './components/SettingsForm'
import { useSettings } from '@/lib/hooks/use-settings'
import { useAuth } from '@/lib/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function SettingsPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { refetch } = useSettings({ enabled: isAdmin })

  return (
    <PageFrame width="reading">
      <PageHeader
        eyebrow={t('navigation.settings')}
        title={t('navigation.general')}
        secondaryActions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh')}
          </Button>
        }
      />
      <SettingsForm />
    </PageFrame>
  )
}
