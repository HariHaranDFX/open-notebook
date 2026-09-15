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
import { useTheme } from '@/lib/stores/theme-store'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Monitor, Sun, Moon, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

const THEME_OPTIONS = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
] as const

const LANGUAGE_OPTIONS = [
  ['en-US', 'common.english'],
  ['ca-ES', 'common.catalan'],
  ['zh-CN', 'common.chinese'],
  ['zh-TW', 'common.traditionalChinese'],
  ['pt-BR', 'common.portuguese'],
  ['ja-JP', 'common.japanese'],
  ['fr-FR', 'common.french'],
  ['ru-RU', 'common.russian'],
  ['bn-IN', 'common.bengali'],
  ['es-ES', 'common.spanish'],
  ['de-DE', 'common.german'],
  ['pl-PL', 'common.polish'],
  ['tr-TR', 'common.turkish'],
] as const

function isLanguageActive(code: string, language?: string) {
  if (code === 'zh-CN') return language === 'zh' || language === 'zh-CN' || Boolean(language?.startsWith('zh-Hans'))
  if (code === 'zh-TW') return language === 'zh-TW' || Boolean(language?.startsWith('zh-Hant'))
  return language === code || Boolean(language?.startsWith(code.split('-')[0]))
}

const settingsSchema = z.object({
  default_content_processing_engine_doc: z.enum(['auto', 'docling', 'simple']).optional(),
  default_content_processing_engine_url: z.enum(['auto', 'firecrawl', 'jina', 'crawl4ai', 'simple']).optional(),
  default_embedding_option: z.enum(['ask', 'always', 'never']).optional(),
  docling_ocr: z.boolean().optional(),
  docling_formulas: z.boolean().optional(),
  docling_vision: z.boolean().optional(),
  original_file_policy: z.enum(['always_keep', 'user_choice', 'always_delete']).optional(),
  original_file_user_default: z.enum(['keep', 'delete_after_processing']).optional(),
  allow_source_owner_cleanup: z.boolean().optional(),
})

type SettingsFormData = z.infer<typeof settingsSchema>

const SELECT_WIDTH = 'w-[200px]'

export function SettingsForm() {
  const { t, language, setLanguage } = useTranslation()
  const { theme, setTheme } = useTheme()
  const activeLangLabel = LANGUAGE_OPTIONS.find(([code]) => isLanguageActive(code, language))?.[1] ?? 'common.english'
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
      docling_ocr: undefined,
      docling_formulas: undefined,
      docling_vision: undefined,
      original_file_policy: undefined,
      original_file_user_default: undefined,
      allow_source_owner_cleanup: undefined,
    },
  })

  useEffect(() => {
    if (settings && settings.default_content_processing_engine_doc && !hasResetForm) {
      reset({
        default_content_processing_engine_doc: settings.default_content_processing_engine_doc as 'auto' | 'docling' | 'simple',
        default_content_processing_engine_url: settings.default_content_processing_engine_url as 'auto' | 'firecrawl' | 'jina' | 'crawl4ai' | 'simple',
        default_embedding_option: settings.default_embedding_option as 'ask' | 'always' | 'never',
        docling_ocr: settings.docling_ocr ?? true,
        docling_formulas: settings.docling_formulas ?? false,
        docling_vision: settings.docling_vision ?? false,
        original_file_policy:
          (settings.original_file_policy as 'always_keep' | 'user_choice' | 'always_delete') ??
          'always_keep',
        original_file_user_default:
          (settings.original_file_user_default as 'keep' | 'delete_after_processing') ?? 'keep',
        allow_source_owner_cleanup: settings.allow_source_owner_cleanup ?? false,
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
          {getApiErrorMessage(error, (key) => t(key), 'common.refreshPage')}
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
            aria-label={label}
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
          <p className="mb-3 text-xs font-medium text-muted-foreground">{t('settings.docling')}</p>
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
        <SettingRow
          label={t('settings.originalFilePolicy')}
          htmlFor="original_file_policy"
          help={t('settings.originalFilePolicyDesc')}
        >
          <Controller
            name="original_file_policy"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value ?? 'always_keep'}
                onValueChange={field.onChange}
                disabled={field.disabled || isLoading}
              >
                <SelectTrigger id="original_file_policy" className={SELECT_WIDTH}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always_keep">{t('settings.originalFilePolicyAlwaysKeep')}</SelectItem>
                  <SelectItem value="user_choice">{t('settings.originalFilePolicyUserChoice')}</SelectItem>
                  <SelectItem value="always_delete">{t('settings.originalFilePolicyAlwaysDelete')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </SettingRow>

        <Controller
          name="original_file_policy"
          control={control}
          render={({ field: policyField }) =>
            policyField.value === 'user_choice' ? (
              <SettingRow
                label={t('settings.originalFileDefault')}
                htmlFor="original_file_user_default"
                help={t('settings.originalFileDefaultDesc')}
              >
                <Controller
                  name="original_file_user_default"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? 'keep'}
                      onValueChange={field.onChange}
                      disabled={field.disabled || isLoading}
                    >
                      <SelectTrigger id="original_file_user_default" className={SELECT_WIDTH}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep">{t('settings.originalFileDefaultKeep')}</SelectItem>
                        <SelectItem value="delete_after_processing">
                          {t('settings.originalFileDefaultDelete')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </SettingRow>
            ) : (
              <></>
            )
          }
        />

        <SettingRow
          label={t('settings.allowOwnerCleanup')}
          htmlFor="allow_source_owner_cleanup"
          help={t('settings.allowOwnerCleanupDesc')}
        >
          <Controller
            name="allow_source_owner_cleanup"
            control={control}
            render={({ field }) => (
              <Switch
                id="allow_source_owner_cleanup"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                disabled={field.disabled || isLoading}
              />
            )}
          />
        </SettingRow>

        <p className="text-xs text-muted-foreground">
          {t('settings.fileRetentionFuture')}
        </p>
      </SettingsSection>

      <SettingsSection title={t('common.preferences')}>
        <SettingRow label={t('common.appearance')}>
          <div className="inline-flex items-center gap-0.5 rounded-[var(--control-radius)] border border-border p-0.5">
            {THEME_OPTIONS.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-label={t(`common.${value}`)}
                aria-pressed={theme === value}
                className={cn(
                  'flex size-7 items-center justify-center rounded-[3px] transition-colors',
                  theme === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={t('common.language')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--control-radius)] border border-border px-3 text-sm text-foreground transition-colors hover:bg-accent"
              >
                {t(activeLangLabel)}
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              {LANGUAGE_OPTIONS.map(([code, label]) => (
                <DropdownMenuItem key={code} onSelect={() => setLanguage(code)}>
                  {t(label)}
                  {isLanguageActive(code, language) && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
