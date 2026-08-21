'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, AlertCircle } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { ResourcePreview } from '@/components/common/ResourcePreview'
import { SearchResultRow, parseParentId } from './SearchResultRow'
import { useSearch } from '@/lib/hooks/use-search'
import { useModelDefaults } from '@/lib/hooks/use-models'
import { useResourcePreview } from '@/lib/hooks/use-resource-preview'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

interface SearchWorkspaceProps {
  initialQuery?: string
}

/**
 * Search workspace: Query / Results / Preview. Owns the query and option state,
 * runs the search mutation, and opens results into the URL-backed preview pane
 * (so the selection is addressable and the results stay put).
 */
export function SearchWorkspace({ initialQuery = '' }: SearchWorkspaceProps) {
  const { t } = useTranslation()
  const search = useSearch()
  const { data: modelDefaults, isLoading: modelsLoading } = useModelDefaults()
  const preview = useResourcePreview()
  const hasEmbeddingModel = !!modelDefaults?.default_embedding_model

  const [query, setQuery] = useState(initialQuery)
  const [type, setType] = useState<'text' | 'vector'>('text')
  const [searchSources, setSearchSources] = useState(true)
  const [searchNotes, setSearchNotes] = useState(true)

  const runSearch = (q: string) => {
    if (!q.trim()) return
    search.mutate({
      query: q,
      type,
      limit: 100,
      search_sources: searchSources,
      search_notes: searchNotes,
      minimum_score: 0.2,
    })
  }

  // Auto-run once when arriving with a deep-linked query.
  const autoRanRef = useRef<string | null>(null)
  useEffect(() => {
    if (initialQuery && autoRanRef.current !== initialQuery) {
      autoRanRef.current = initialQuery
      setQuery(initialQuery)
      runSearch(initialQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery])

  const data = search.data
  const previewOpen = Boolean(preview.type && preview.id)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(query) }}
            placeholder={t('searchPage.enterSearchPlaceholder')}
            aria-label={t('common.accessibility.enterSearch')}
            autoComplete="off"
            disabled={search.isPending}
            className="flex-1"
          />
          <Button onClick={() => runSearch(query)} disabled={search.isPending || !query.trim()} className="w-full sm:w-auto">
            {search.isPending ? <LoadingSpinner size="sm" /> : <Search className="size-4" />}
            {t('searchPage.search')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div role="group" aria-labelledby="search-type-label" className="flex items-center gap-3">
            <span id="search-type-label" className="text-sm font-medium">{t('searchPage.searchType')}</span>
            <RadioGroup
              name="search-type"
              value={type}
              onValueChange={(value: 'text' | 'vector') => setType(value)}
              disabled={modelsLoading || search.isPending}
              className="flex items-center gap-3"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="text" id="stype-text" />
                <Label htmlFor="stype-text" className="cursor-pointer font-normal">{t('searchPage.textSearch')}</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="vector" id="stype-vector" disabled={!hasEmbeddingModel || search.isPending} />
                <Label
                  htmlFor="stype-vector"
                  className={cn('font-normal', hasEmbeddingModel ? 'cursor-pointer' : 'cursor-not-allowed text-muted-foreground')}
                >
                  {t('searchPage.vectorSearch')}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div role="group" aria-labelledby="search-in-label" className="flex items-center gap-3">
            <span id="search-in-label" className="text-sm font-medium">{t('searchPage.searchIn')}</span>
            <div className="flex items-center gap-1.5">
              <Checkbox id="scope-sources" checked={searchSources} onCheckedChange={c => setSearchSources(c as boolean)} disabled={search.isPending} />
              <Label htmlFor="scope-sources" className="cursor-pointer font-normal">{t('searchPage.searchSources')}</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox id="scope-notes" checked={searchNotes} onCheckedChange={c => setSearchNotes(c as boolean)} disabled={search.isPending} />
              <Label htmlFor="scope-notes" className="cursor-pointer font-normal">{t('searchPage.searchNotes')}</Label>
            </div>
          </div>
        </div>

        {!hasEmbeddingModel && (
          <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
            <AlertCircle className="size-4" aria-hidden="true" />
            {t('searchPage.vectorSearchWarning')}
          </p>
        )}
      </div>

      <div className={cn('grid min-h-0 flex-1 gap-4', previewOpen ? 'lg:grid-cols-2' : 'grid-cols-1')}>
        <div className="min-h-0 overflow-y-auto">
          {search.isPending ? (
            <div className="flex h-full items-center justify-center"><LoadingSpinner /></div>
          ) : search.isError ? (
            <EmptyState
              icon={AlertCircle}
              title={t('apiErrors.searchFailed')}
              action={<Button variant="outline" size="sm" onClick={() => runSearch(query)}>{t('common.retry')}</Button>}
            />
          ) : !data ? (
            <EmptyState icon={Search} title={t('searchPage.search')} description={t('searchPage.searchDesc')} />
          ) : data.results.length === 0 ? (
            <EmptyState icon={Search} title={t('searchPage.noResultsFor', { query })} />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{t('searchPage.resultsFound', { count: data.total_count })}</h3>
                <Badge variant="outline">
                  {data.search_type === 'text' ? t('searchPage.textSearch') : t('searchPage.vectorSearch')}
                </Badge>
              </div>
              <div className="space-y-2">
                {data.results.map((result, i) => {
                  const parsed = parseParentId(result.parent_id)
                  const isActive = Boolean(parsed && preview.type === parsed.type && preview.id === parsed.id)
                  return (
                    <SearchResultRow
                      key={result.id ?? i}
                      result={result}
                      onPreview={preview.openPreview}
                      isActive={isActive}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {previewOpen && preview.type && preview.id && (
          <div className="min-h-0 overflow-hidden rounded-[var(--surface-radius)] border border-border bg-card">
            <ResourcePreview type={preview.type} id={preview.id} onClose={preview.closePreview} />
          </div>
        )}
      </div>
    </div>
  )
}
