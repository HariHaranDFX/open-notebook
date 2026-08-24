'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { SettingsSection, SettingRow } from '@/components/settings/SettingRow'
import { useSettings, useUpdateSettings } from '@/lib/hooks/use-settings'
import { useCapabilities } from '@/lib/hooks/use-capabilities'
import { useEffect, useState } from 'react'
import { useTranslation } from '@/lib/hooks/use-translation'

const settingsSchema = z.object({
  default_content_processing_engine_doc: z.enum(['auto', 'docling', 'simple']).optional(),
  default_content_processing_engine_url: z.enum(['auto', 'firecrawl', 'jina', 'crawl4ai', 'simple']).optional(),
  default_embedding_option: z.enum(['ask', 'always', 'never']).optional(),
  auto_delete_files: z.enum(['yes', 'no']).optional(),
  docling_ocr: z.boolean().optional(),
  docling_formulas: z.boolean().optional(),
  docling_vision: z.boolean().optional(),
})

type SettingsFormData = z.infer<typeof settingsSchema>

const SELECT_WIDTH = 'w-[200px]'

export function SettingsForm() {
  const { t } = useTranslation()
  const { data: settings, isLoading, error } = useSettings()
  const { data: capabilities, isError: capabilitiesError } = useCapabilities()
  const updateSettings = useUpdateSettings()
  // Opt-in heavy runtimes are installed on demand at container startup, so an
  // engine is only offered when the backend probe confirms it's actually
  // available. While the probe is still loading, default to available to avoid a
  // flash of disabled controls on a correctly-configured install; but if the
  // probe *fails*, fail closed (treat as unavailable) rather than advertising an
  // engine the backend couldn't verify.
  const doclingAvailable = capabilities?.docling_available ?? !capabilitiesError
  const crawl4aiAvailable = capabilities?.crawl4ai_available ?? !capabilitiesError
  const [hasResetForm, setHasResetForm] = useState(false)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      default_content_processing_engine_doc: undefined,
      default_content_processing_engine_url: undefined,
      default_embedding_option: undefined,
      auto_delete_files: undefined,
      docling_ocr: undefined,
      docling_formulas: undefined,
      docling_vision: undefined,
    },
  })

  useEffect(() => {
    if (settings && settings.default_content_processing_engine_doc && !hasResetForm) {
      reset({
        default_content_processing_engine_doc: settings.default_content_processing_engine_doc as 'auto' | 'docling' | 'simple',
        default_content_processing_engine_url: settings.default_content_processing_engine_url as 'auto' | 'firecrawl' | 'jina' | 'crawl4ai' | 'simple',
        default_embedding_option: settings.default_embedding_option as 'ask' | 'always' | 'never',
        auto_delete_files: settings.auto_delete_files as 'yes' | 'no',
        docling_ocr: settings.docling_ocr ?? true,
        docling_formulas: settings.docling_formulas ?? false,
        docling_vision: settings.docling_vision ?? false,
      })
      setHasResetForm(true)
    }
  }, [hasResetForm, reset, settings])

  const onSubmit = async (data: SettingsFormData) => {
    await updateSettings.mutateAsync(data)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('settings.loadFailed')}</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : t('common.error')}
        </AlertDescription>
      </Alert>
    )
  }

  const doclingToggle = (
    name: 'docling_ocr' | 'docling_formulas' | 'docling_vision',
    label: string,
    help: string,
    defaultChecked: boolean
  ) => (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={name} className="text-sm font-medium">{label}</Label>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{help}</p>
      </div>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Switch
            id={name}
            checked={field.value ?? defaultChecked}
            onCheckedChange={field.onChange}
            disabled={isLoading || !doclingAvailable}
          />
        )}
      />
    </div>
  )

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <SettingsSection title={t('settings.contentProcessing')} description={t('settings.contentProcessingDesc')}>
        <SettingRow
          label={t('settings.docEngine')}
          htmlFor="doc_engine"
          help={t('settings.docHelp')}
          description={!doclingAvailable ? t('settings.enableDoclingHint') : undefined}
        >
          <Controller
            name="default_content_processing_engine_doc"
            control={control}
            render={({ field }) => (
              <Select key={field.value} name={field.name} value={field.value || ''} onValueChange={field.onChange} disabled={field.disabled || isLoading}>
                <SelectTrigger id="doc_engine" className={SELECT_WIDTH}>
                  <SelectValue placeholder={t('settings.docEnginePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('settings.autoRecommended')}</SelectItem>
                  <SelectItem value="docling" disabled={!doclingAvailable}>{t('settings.docling')}</SelectItem>
                  <SelectItem value="simple">{t('settings.simple')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </SettingRow>

        <div className="border-t border-border/40 py-3.5">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">{t('settings.docling')}</p>
          <div className="space-y-3.5">
            {doclingToggle('docling_ocr', t('settings.ocrEnabled'), t('settings.ocrHelp'), true)}
            {doclingToggle('docling_formulas', t('settings.formulasEnabled'), t('settings.formulasHelp'), false)}
            {doclingToggle('docling_vision', t('settings.visionEnabled'), t('settings.visionHelp'), false)}
          </div>
        </div>

        <SettingRow
          label={t('settings.urlEngine')}
          htmlFor="url_engine"
          help={t('settings.urlHelp')}
          description={!crawl4aiAvailable ? t('settings.enableCrawl4aiHint') : undefined}
        >
          <Controller
            name="default_content_processing_engine_url"
            control={control}
            render={({ field }) => (
              <Select key={field.value} name={field.name} value={field.value || ''} onValueChange={field.onChange} disabled={field.disabled || isLoading}>
                <SelectTrigger id="url_engine" className={SELECT_WIDTH}>
                  <SelectValue placeholder={t('settings.urlEnginePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('settings.autoRecommended')}</SelectItem>
                  <SelectItem value="firecrawl">{t('settings.firecrawl')}</SelectItem>
                  <SelectItem value="jina">{t('settings.jina')}</SelectItem>
                  <SelectItem value="crawl4ai" disabled={!crawl4aiAvailable}>{t('settings.crawl4ai')}</SelectItem>
                  <SelectItem value="simple">{t('settings.simple')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.embeddingAndSearch')} description={t('settings.embeddingAndSearchDesc')}>
        <SettingRow label={t('settings.defaultEmbeddingOption')} htmlFor="embedding" help={t('settings.embeddingHelp')}>
          <Controller
            name="default_embedding_option"
            control={control}
            render={({ field }) => (
              <Select key={field.value} name={field.name} value={field.value || ''} onValueChange={field.onChange} disabled={field.disabled || isLoading}>
                <SelectTrigger id="embedding" className={SELECT_WIDTH}>
                  <SelectValue placeholder={t('settings.embeddingOptionPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ask">{t('settings.ask')}</SelectItem>
                  <SelectItem value="always">{t('settings.always')}</SelectItem>
                  <SelectItem value="never">{t('settings.never')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.fileManagement')} description={t('settings.fileManagementDesc')}>
        <SettingRow label={t('settings.autoDeleteFiles')} htmlFor="auto_delete" help={t('settings.filesHelp')}>
          <Controller
            name="auto_delete_files"
            control={control}
            render={({ field }) => (
              <Switch
                id="auto_delete"
                checked={field.value === 'yes'}
                onCheckedChange={(checked) => field.onChange(checked ? 'yes' : 'no')}
                disabled={field.disabled || isLoading}
              />
            )}
          />
        </SettingRow>
      </SettingsSection>

      <div className="flex justify-end border-t border-border/40 pt-4">
        <Button type="submit" disabled={!isDirty || updateSettings.isPending}>
          {updateSettings.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}
