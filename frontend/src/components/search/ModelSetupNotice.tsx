'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'

interface ModelSetupNoticeProps {
  title: string
  description: string
}

/** Setup warning used when Search or Ask is missing a required model. */
export function ModelSetupNotice({ title, description }: ModelSetupNoticeProps) {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      className="flex flex-col gap-3 border border-warning/40 bg-warning-surface p-4 text-warning sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{title}</p>
          <p className="mt-0.5 text-sm font-normal leading-snug text-foreground">{description}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-center" asChild>
        <Link href="/settings/models">{t('searchPage.setUpModels')}</Link>
      </Button>
    </div>
  )
}
