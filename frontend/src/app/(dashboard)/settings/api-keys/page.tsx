'use client'

import { useMemo, useState } from 'react'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldAlert, AlertCircle, Search } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { useModels, useModelDefaults } from '@/lib/hooks/use-models'
import {
  useCredentials,
  useCredentialStatus,
  useEnvStatus,
} from '@/lib/hooks/use-credentials'
import { useProviders } from '@/lib/hooks/use-providers'
import { Credential } from '@/lib/api/credentials'
import {
  DefaultModelSelectors,
  MigrationBanner,
  ProviderSection,
} from '@/components/settings'

export default function ApiKeysPage() {
  const { t } = useTranslation()

  // Data
  const { data: credentials, isLoading: credentialsLoading } = useCredentials()
  const { data: models, isLoading: modelsLoading } = useModels()
  const { data: defaults, isLoading: defaultsLoading } = useModelDefaults()
  const { data: credentialStatus } = useCredentialStatus()
  const { data: envStatus } = useEnvStatus()
  const {
    data: providers,
    isLoading: providersLoading,
    isError: providersError,
  } = useProviders()

  const encryptionReady = credentialStatus?.encryption_configured ?? true

  // Group credentials by provider
  const credentialsByProvider = useMemo(() => {
    const grouped: Record<string, Credential[]> = {}
    for (const provider of providers ?? []) {
      grouped[provider.name] = []
    }
    if (credentials) {
      for (const cred of credentials) {
        if (!grouped[cred.provider]) grouped[cred.provider] = []
        grouped[cred.provider].push(cred)
      }
    }
    return grouped
  }, [credentials, providers])

  // Providers needing migration
  const providersToMigrate = useMemo(() => {
    if (!envStatus || !credentialStatus) return []
    const result: string[] = []
    for (const provider in envStatus) {
      if (envStatus[provider] && credentialStatus.source[provider] === 'environment') {
        result.push(provider)
      }
    }
    return result
  }, [envStatus, credentialStatus])

  // Sort: configured providers first (the backend registry owns the base order)
  const sortedProviders = useMemo(() => {
    return [...(providers ?? [])].sort((a, b) => {
      const aHas = (credentialsByProvider[a.name]?.length || 0) > 0 ? 1 : 0
      const bHas = (credentialsByProvider[b.name]?.length || 0) > 0 ? 1 : 0
      return bHas - aHas
    })
  }, [providers, credentialsByProvider])

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'configured' | 'all'>('configured')

  const searchLower = search.trim().toLowerCase()
  const searchedProviders = sortedProviders.filter((p) => {
    if (!searchLower) return true
    return (
      (p.display_name || p.name).toLowerCase().includes(searchLower) ||
      p.name.toLowerCase().includes(searchLower)
    )
  })
  const visibleProviders = searchedProviders.filter(
    (p) => filter === 'all' || (credentialsByProvider[p.name]?.length ?? 0) > 0
  )
  const hiddenCount = searchedProviders.length - visibleProviders.length

  const isLoading = credentialsLoading || modelsLoading || defaultsLoading || providersLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        eyebrow={t('navigation.settings')}
        title={t('apiKeys.title')}
        description={t('apiKeys.description')}
      />

      {/* Encryption warning */}
      {!encryptionReady && (
        <Alert className="border-red-500/50 bg-red-50 dark:bg-red-950/20">
          <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
          <AlertTitle className="text-red-800 dark:text-red-200">{t('apiKeys.encryptionRequired')}</AlertTitle>
          <AlertDescription className="text-red-700 dark:text-red-300">
            <code className="text-xs bg-red-100 dark:bg-red-900/30 px-1 py-0.5 rounded">
              {t('apiKeys.encryptionRequiredDescription')}
            </code>
          </AlertDescription>
        </Alert>
      )}

      {/* Migration banner */}
      {encryptionReady && <MigrationBanner providersToMigrate={providersToMigrate} />}

      {/* Default Model Selectors */}
      {models && defaults && (
        <DefaultModelSelectors models={models} defaults={defaults} />
      )}

      {/* Providers */}
      {providersError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('apiKeys.providersLoadFailed')}</AlertTitle>
          <AlertDescription>{t('apiKeys.providersLoadFailedDescription')}</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">{t('apiKeys.providers')}</h2>
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('common.search')}
                  aria-label={t('apiKeys.providers')}
                  className="pl-8"
                />
              </div>
              <div className="inline-flex shrink-0 rounded-[var(--control-radius)] border border-border p-0.5">
                {(['configured', 'all'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={cn(
                      'rounded-[calc(var(--control-radius)-2px)] px-2.5 py-1 text-xs font-medium transition-colors',
                      filter === f
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {f === 'configured' ? t('apiKeys.configured') : t('apiKeys.showAll')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {visibleProviders.length > 0 ? (
            <div className="grid gap-4">
              {visibleProviders.map((provider) => (
                <ProviderSection
                  key={provider.name}
                  provider={provider}
                  credentials={credentialsByProvider[provider.name] || []}
                  models={models || []}
                  defaults={defaults || null}
                  allCredentials={credentials || []}
                  encryptionReady={encryptionReady}
                />
              ))}
            </div>
          ) : searchLower ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('common.noMatches')}</p>
          ) : null}

          {filter === 'configured' && hiddenCount > 0 && (
            <div className="text-center">
              <Button variant="link" size="sm" onClick={() => setFilter('all')}>
                {t('apiKeys.moreAvailable', { count: hiddenCount })}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Help link */}
      <div className="border-t pt-4">
        <a
          href="https://github.com/lfnovo/open-notebook/blob/main/docs/5-CONFIGURATION/ai-providers.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          {t('apiKeys.learnMore')}
        </a>
      </div>
    </PageFrame>
  )
}
