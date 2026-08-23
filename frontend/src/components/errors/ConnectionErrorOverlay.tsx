'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Database, Server, ExternalLink } from 'lucide-react'
import { ConnectionError } from '@/lib/types/config'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useBrand } from '@/components/providers/BrandProvider'

const UPSTREAM_DOCUMENTATION_URL = 'https://github.com/lfnovo/open-notebook'

interface ConnectionErrorOverlayProps {
  error: ConnectionError
  onRetry: () => void
}

/**
 * Full-screen recovery state for a broken API/database connection.
 *
 * Deliberately shows only fixed, translated copy keyed on `error.type` —
 * never an attempted URL, technical message, or stack trace. Self-hosters
 * troubleshoot from their own deployment logs, not from what an end user's
 * browser can see.
 */
export function ConnectionErrorOverlay({
  error,
  onRetry,
}: ConnectionErrorOverlayProps) {
  const { t } = useTranslation()
  const { appName, supportUrl } = useBrand()
  const isApiError = error.type === 'api-unreachable'

  return (
    <div
      className="fixed inset-0 bg-background z-50 flex items-center justify-center p-4"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <Card className="max-w-lg w-full p-8 space-y-6">
        {/* Error icon and title */}
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-error-surface">
            {isApiError ? (
              <Server className="w-6 h-6 text-error" aria-hidden="true" />
            ) : (
              <Database className="w-6 h-6 text-error" aria-hidden="true" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-semibold" id="error-title">
              {isApiError
                ? t('connectionErrors.apiTitle')
                : t('connectionErrors.dbTitle')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isApiError
                ? t('connectionErrors.apiDesc')
                : t('connectionErrors.dbDesc')}
            </p>
          </div>
        </div>

        {/* Cause: what this usually means, in safe, general terms */}
        <div className="space-y-2 border-l-4 border-border-strong pl-4">
          <h2 className="font-semibold text-sm">{t('connectionErrors.troubleshooting')}</h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            {isApiError ? (
              <>
                <li>{t('connectionErrors.apiUnreachable1')}</li>
                <li>{t('connectionErrors.apiUnreachable2')}</li>
                <li>{t('connectionErrors.apiUnreachable3')}</li>
              </>
            ) : (
              <>
                <li>{t('connectionErrors.dbFailed1')}</li>
                <li>{t('connectionErrors.dbFailed2')}</li>
                <li>{t('connectionErrors.dbFailed3')}</li>
              </>
            )}
          </ul>
        </div>

        {/* Documentation link */}
        <div className="text-sm">
          <p>{t('connectionErrors.seeDocumentation')}</p>
          <a
            href={supportUrl ?? UPSTREAM_DOCUMENTATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {supportUrl ? appName : t('connectionErrors.docLink')}
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </a>
        </div>

        {/* Recovery */}
        <div className="pt-4 border-t border-border">
          <Button onClick={onRetry} className="w-full" size="lg" autoFocus>
            {t('connectionErrors.retryLabel')}
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            {t('connectionErrors.retryHint')}
          </p>
        </div>
      </Card>
    </div>
  )
}
