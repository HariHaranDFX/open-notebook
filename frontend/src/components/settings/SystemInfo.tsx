'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { getConfig } from '@/lib/config'
import { SettingsSection } from '@/components/settings/SettingRow'
import { useTranslation } from '@/lib/hooks/use-translation'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/40 py-3.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

export function SystemInfo() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<{
    version: string
    latestVersion?: string | null
    hasUpdate?: boolean
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((err) => console.error('Failed to load config:', err))
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <SettingsSection title={t('advanced.systemInfo')}>
      <InfoRow label={t('advanced.currentVersion')}>
        <span className="tabular-nums">
          {isLoading ? t('common.loading') : config?.version || t('advanced.unknown')}
        </span>
      </InfoRow>

      {config?.latestVersion && (
        <InfoRow label={t('advanced.latestVersion')}>
          <span className="tabular-nums">{config.latestVersion}</span>
        </InfoRow>
      )}

      <InfoRow label={t('advanced.status')}>
        {config?.hasUpdate ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/50 px-2.5 py-0.5 text-[13px] text-destructive">
            {t('advanced.updateAvailable', { version: config.latestVersion || '' })}
          </span>
        ) : config?.latestVersion ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-600 px-2.5 py-0.5 text-[13px] text-green-600">
            <Check className="size-3.5" />
            {t('advanced.upToDate')}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('advanced.unknown')}</span>
        )}
      </InfoRow>

      {config?.hasUpdate && (
        <div className="border-t border-border/40 py-3.5">
          <a
            href="https://github.com/lfnovo/open-notebook"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            {t('advanced.viewOnGithub')}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}

      {!config?.latestVersion && config?.version && (
        <p className="border-t border-border/40 pt-3.5 text-[13px] text-muted-foreground">
          {t('advanced.updateCheckFailed')}
        </p>
      )}
    </SettingsSection>
  )
}
