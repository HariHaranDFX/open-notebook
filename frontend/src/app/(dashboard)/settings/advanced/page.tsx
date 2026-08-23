'use client'

import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { RebuildEmbeddings, SystemInfo } from '@/components/settings'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function AdvancedPage() {
  const { t } = useTranslation()

  return (
    <PageFrame width="reading">
      <PageHeader
        eyebrow={t('navigation.settings')}
        title={t('advanced.title')}
        description={t('advanced.desc')}
      />
      <SystemInfo />
      <RebuildEmbeddings />
    </PageFrame>
  )
}
