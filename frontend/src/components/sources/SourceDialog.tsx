'use client'

import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { SourceDetailContent } from './SourceDetailContent'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toReferenceRecordId } from '@/lib/utils/source-references'

interface SourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceId: string | null
}

/**
 * Source detail sheet.
 *
 * Displays source details and provides a path to the full source workspace.
 */
export function SourceDialog({ open, onOpenChange, sourceId }: SourceDialogProps) {
  const { t } = useTranslation()
  const router = useRouter()
  // Ensure source ID has 'source:' prefix for API calls and routing
  const sourceIdWithPrefix = sourceId ? toReferenceRecordId('source', sourceId) : null

  const handleChatClick = () => {
    if (sourceIdWithPrefix) {
      onOpenChange(false)
      router.push(`/sources/${sourceIdWithPrefix}`)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  if (!sourceIdWithPrefix) {
    return null
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent showCloseButton={false} className="flex w-full max-w-[calc(100vw-1.5rem)] flex-col p-0 sm:max-w-3xl">
        <SheetHeader className="sr-only">
          <SheetTitle>{t('sources.detailsTitle')}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <SourceDetailContent
            sourceId={sourceIdWithPrefix}
          />
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-border px-6 py-3 sm:justify-between">
          <Button type="button" variant="outline" onClick={handleClose}>
            {t('common.close')}
          </Button>
          <Button type="button" onClick={handleChatClick}>
            {t('chat.chatWith', { name: t('navigation.sources') })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
