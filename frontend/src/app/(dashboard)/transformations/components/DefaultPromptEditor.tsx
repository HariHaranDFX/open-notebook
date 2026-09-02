'use client'

import { useState, useEffect, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight, Settings } from 'lucide-react'
import { useDefaultPrompt, useUpdateDefaultPrompt } from '@/lib/hooks/use-transformations'
import { useTranslation } from '@/lib/hooks/use-translation'

export function DefaultPromptEditor() {
  const [isOpen, setIsOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const { data: defaultPrompt, isLoading } = useDefaultPrompt()
  const updateDefaultPrompt = useUpdateDefaultPrompt()
  const { t } = useTranslation()
  const textareaId = useId()

  useEffect(() => {
    if (defaultPrompt) {
      setPrompt(defaultPrompt.transformation_instructions || '')
    }
  }, [defaultPrompt])

  const handleSave = () => {
    updateDefaultPrompt.mutate({ transformation_instructions: prompt })
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-[var(--surface-radius)] border bg-card transition-colors hover:bg-muted/50">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {t('transformations.defaultPrompt')}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t('transformations.defaultPromptDesc')}
                </p>
              </div>
            </div>
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 py-3">
            <Label htmlFor={textareaId} className="sr-only">
              {t('transformations.defaultPrompt')}
            </Label>
            <Textarea
              id={textareaId}
              name="default-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('transformations.defaultPromptPlaceholder')}
              className="min-h-[200px] font-mono text-sm"
              disabled={isLoading}
            />
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isLoading || updateDefaultPrompt.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
