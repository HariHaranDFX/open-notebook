'use client'

import { AlertCircle, FileQuestion, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { useTranslation } from '@/lib/hooks/use-translation'

interface ContentUnavailableProps {
  /**
   * 'not-found' — the item was deleted or no longer exists (HTTP 404).
   * 'forbidden' — the item exists but the caller's access role doesn't
   *   permit opening it (HTTP 403), e.g. a read-only share.
   * 'error' — the item could not be loaded (network/server failure).
   */
  variant: 'not-found' | 'forbidden' | 'error'
  onClose?: () => void
}

const VARIANT_COPY = {
  'not-found': {
    titleKey: 'common.contentUnavailable.notFoundTitle',
    descriptionKey: 'common.contentUnavailable.notFoundDescription',
    icon: FileQuestion,
    // Informational, not a failure: nothing broke, the item is just gone.
    live: 'polite' as const,
  },
  forbidden: {
    titleKey: 'common.contentUnavailable.forbiddenTitle',
    descriptionKey: 'common.contentUnavailable.forbiddenDescription',
    icon: Lock,
    live: 'assertive' as const,
  },
  error: {
    titleKey: 'common.contentUnavailable.errorTitle',
    descriptionKey: 'common.contentUnavailable.errorDescription',
    icon: AlertCircle,
    live: 'assertive' as const,
  },
} as const

/**
 * Shared friendly state for content that cannot be displayed.
 *
 * Used by the source, note and insight dialogs so that dangling references
 * (e.g. citations in old chat messages pointing at deleted items) render the
 * exact same explanation everywhere instead of a blank dialog or a raw error.
 */
export function ContentUnavailable({ variant, onClose }: ContentUnavailableProps) {
  const { t } = useTranslation()
  const { titleKey, descriptionKey, icon, live } = VARIANT_COPY[variant]

  return (
    <div
      className="flex h-full flex-col justify-center px-6"
      data-testid="content-unavailable"
      role={live === 'assertive' ? 'alert' : 'status'}
      aria-live={live}
    >
      <EmptyState
        icon={icon}
        title={t(titleKey)}
        description={t(descriptionKey)}
        action={
          onClose && (
            <Button variant="outline" size="sm" onClick={onClose} autoFocus>
              {t('common.close')}
            </Button>
          )
        }
      />
    </div>
  )
}
