'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { ContextMode } from '@/lib/types/notebook-context'

interface ContextSelectorProps {
  value: ContextMode
  kind: 'source' | 'note'
  hasInsights?: boolean
  onValueChange: (value: ContextMode) => void
  disabled?: boolean
}

export function ContextSelector({
  value,
  kind,
  hasInsights = false,
  onValueChange,
  disabled = false,
}: ContextSelectorProps) {
  const { t } = useTranslation()
  const label = kind === 'source'
    ? t('common.contextModes.sourceLabel')
    : t('common.contextModes.noteLabel')
  const options = kind === 'note'
    ? [
        { value: 'off' as const, label: t('common.contextModes.off') },
        { value: 'full' as const, label: t('common.contextModes.included') },
      ]
    : [
        { value: 'off' as const, label: t('common.contextModes.off') },
        ...(hasInsights
          ? [{ value: 'insights' as const, label: t('common.contextModes.insights') }]
          : []),
        { value: 'full' as const, label: t('common.contextModes.full') },
      ]

  const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <span className="min-w-0" onClick={stopPropagation} onPointerDown={stopPropagation}>
      <Select
        value={value}
        onValueChange={next => onValueChange(next as ContextMode)}
        disabled={disabled}
      >
        <SelectTrigger size="sm" aria-label={label} className="max-w-full min-w-32 bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}
