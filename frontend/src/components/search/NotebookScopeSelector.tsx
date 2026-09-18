'use client'

import { useState } from 'react'
import { ChevronDown, Notebook as NotebookIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckboxList } from '@/components/ui/checkbox-list'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

interface NotebookScopeSelectorProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  className?: string
}

/**
 * Optional notebook scope shared by the Search and Ask panels.
 *
 * Nothing selected = whole knowledge base (historical behavior). Backed by
 * SearchRequest.notebook_ids on the API — validated server-side, so a bad id
 * returns 400/404 before the search runs (see api/routers/search.py).
 *
 * Backport of upstream lfnovo/open-notebook#1331 rebuilt in WP3 style.
 */
export function NotebookScopeSelector({
  selectedIds,
  onChange,
  disabled = false,
  className,
}: NotebookScopeSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: notebooks, isLoading } = useNotebooks(false) // false = not archived

  const items = (notebooks ?? []).map((nb) => ({
    id: nb.id,
    title: nb.name,
    description: nb.description || undefined,
  }))

  const handleToggle = (id: string) => {
    if (disabled) return
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    )
  }

  const summary =
    selectedIds.length === 0
      ? t('searchPage.scopeAllNotebooks')
      : t('searchPage.scopeNotebooksSelected', { count: selectedIds.length })

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn('space-y-2', className)}
      data-testid="notebook-scope"
    >
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium leading-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm disabled:opacity-50"
            aria-expanded={open}
            disabled={disabled}
          >
            <NotebookIcon className="size-4" aria-hidden="true" />
            <span>{t('searchPage.scopeNotebooks')}</span>
            <Badge
              variant={selectedIds.length === 0 ? 'outline' : 'secondary'}
              className="font-normal"
            >
              {summary}
            </Badge>
            <ChevronDown
              className={cn(
                'size-4 transition-transform',
                open && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        {selectedIds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs"
            onClick={() => onChange([])}
            disabled={disabled}
          >
            {t('searchPage.scopeClear')}
          </Button>
        )}
      </div>
      <CollapsibleContent className="space-y-2">
        <CheckboxList
          items={items}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          loading={isLoading}
          emptyMessage={t('searchPage.scopeNoNotebooks')}
        />
        <p className="text-xs text-muted-foreground">
          {t('searchPage.scopeHint')}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
