'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Plug, RefreshCw } from 'lucide-react'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import { AppShell } from '@/components/layout/AppShell'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConnectSharePoint, useDisconnectSharePoint, useSharePointStatus } from '@/lib/hooks/use-sharepoint'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useLibraryView } from '@/lib/stores/library-view-store'
import { cn } from '@/lib/utils'

type ConnectionTone = 'connected' | 'reauth_required' | 'disconnected' | 'unavailable'

export default function ConnectionsPage() {
  const { t } = useTranslation()
  const { viewMode, setViewMode } = useLibraryView('connections')
  const status = useSharePointStatus()
  const connect = useConnectSharePoint()
  const disconnect = useDisconnectSharePoint()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const connection = status.data?.status ?? (status.data?.connected ? 'connected' : 'disconnected')
  const tone: ConnectionTone = !status.data?.available ? 'unavailable' : connection

  const beginConnection = () => connect.mutate(undefined, {
    onSuccess: ({ authorization_url }) => window.location.assign(authorization_url),
  })

  const tones: Record<ConnectionTone, { icon: typeof Plug; label: string; className: string }> = {
    connected: { icon: CheckCircle2, label: t('sharepoint.connected'), className: 'border-success/40 bg-success-surface text-success' },
    reauth_required: { icon: AlertTriangle, label: t('sharepoint.needsReconnect'), className: 'border-warning/40 bg-warning-surface text-warning' },
    disconnected: { icon: Plug, label: t('sharepoint.notConnected'), className: 'border-border bg-muted text-muted-foreground' },
    unavailable: { icon: Plug, label: t('sharepoint.unavailableStatus'), className: 'border-border bg-muted text-muted-foreground' },
  }
  const current = tones[tone]
  const StatusIcon = current.icon

  return (
    <AppShell>
      <PageFrame className="space-y-4 py-4 sm:py-4">
        <PageHeader
          title={t('navigation.connections')}
          description={t('sharepoint.connectionsDescription')}
          secondaryActions={(
            <ViewModeToggle
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              label={t('common.viewMode')}
              listLabel={t('common.listView')}
              cardLabel={t('common.cardView')}
            />
          )}
        />

        {status.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="flex min-h-48 items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : status.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-[var(--surface-radius)] border border-border p-4">
            <p>{t('sharepoint.requestFailed')}</p>
            <Button type="button" variant="outline" onClick={() => void status.refetch()}>
              <RefreshCw />
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div
            data-view-mode={viewMode}
            className={cn(
              viewMode === 'card'
                ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
                : 'overflow-hidden rounded-[var(--surface-radius)] border border-border',
            )}
          >
            <article className={cn(
              'flex flex-col gap-3 bg-card',
              viewMode === 'card'
                ? 'rounded-[var(--surface-radius)] border border-border p-4'
                : 'px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
            )}>
              <div className="min-w-0">
                <Badge variant="outline" className={cn(current.className, 'mb-2')}>
                  <StatusIcon aria-hidden="true" />
                  {current.label}
                </Badge>
                <h2 className="text-base font-medium leading-tight">{t('sharepoint.title')}</h2>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  {tone === 'unavailable' ? t('sharepoint.unavailable') : t('sharepoint.cardDescription')}
                </p>
              </div>
              {tone === 'connected' && (
                <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(true)}>
                  {t('sharepoint.disconnect')}
                </Button>
              )}
              {tone === 'reauth_required' && (
                <Button type="button" disabled={connect.isPending} onClick={beginConnection}>
                  {t('sharepoint.reconnect')}
                </Button>
              )}
              {tone === 'disconnected' && (
                <Button type="button" disabled={connect.isPending} onClick={beginConnection}>
                  {t('sharepoint.connect')}
                </Button>
              )}
            </article>
          </div>
        )}
        {connect.isError && <p role="alert">{t('sharepoint.requestFailed')}</p>}
      </PageFrame>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t('sharepoint.disconnect')}
        description={`${t('sharepoint.disconnectConfirm')} ${t('sharepoint.disconnectMicrosoft')}`}
        confirmText={t('sharepoint.disconnect')}
        confirmVariant="destructive"
        onConfirm={() => disconnect.mutate(undefined, { onSuccess: () => setConfirmDisconnect(false) })}
        isLoading={disconnect.isPending}
      />
    </AppShell>
  )
}
