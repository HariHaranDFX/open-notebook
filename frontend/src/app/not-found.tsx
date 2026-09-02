'use client'

import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function NotFound() {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div
        className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <FileQuestion className="size-7" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold text-foreground">{t('notFound.title')}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{t('notFound.description')}</p>
      </div>
      <Button asChild>
        <Link href="/notebooks">{t('notFound.backHome')}</Link>
      </Button>
    </main>
  )
}
