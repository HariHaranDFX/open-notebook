'use client'

import { Lightbulb, Plus, Sparkles, Trash2 } from 'lucide-react'

import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SourceInsightResponse } from '@/lib/api/insights'
import type { Transformation } from '@/lib/types/transformations'

interface SourceInsightsPaneProps {
  insights: SourceInsightResponse[]
  transformations: Transformation[]
  selectedTransformation: string
  loadingInsights: boolean
  creatingInsight: boolean
  canEdit: boolean
  onTransformationChange: (id: string) => void
  onCreateInsight: () => void
  onViewInsight: (insight: SourceInsightResponse) => void
  onDeleteInsight: (insightId: string) => void
}

export function SourceInsightsPane({
  insights,
  transformations,
  selectedTransformation,
  loadingInsights,
  creatingInsight,
  canEdit,
  onTransformationChange,
  onCreateInsight,
  onViewInsight,
  onDeleteInsight,
}: SourceInsightsPaneProps) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 rounded-none border-0 py-0 shadow-none">
      <CardHeader className="sr-only">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Lightbulb className="size-5" />
            {t('common.insights')}
          </span>
          <Badge variant="secondary" className="tabular-nums">{insights.length}</Badge>
        </CardTitle>
        <CardDescription>{t('sources.insightsDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 py-4">
        {canEdit && (
          <div className="border bg-muted/30 p-4">
            <Label htmlFor="transformation-select" className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4" />
              {t('sources.generateNewInsight')}
            </Label>
            <div
              data-testid="insight-generation-controls"
              className="flex min-w-0 items-center gap-2"
            >
              <Select
                name="transformation"
                value={selectedTransformation}
                onValueChange={onTransformationChange}
                disabled={creatingInsight}
              >
                <SelectTrigger
                  id="transformation-select"
                  size="sm"
                  className="min-w-0 flex-1 bg-card"
                >
                  <SelectValue placeholder={t('sources.selectTransformation')} />
                </SelectTrigger>
                <SelectContent>
                  {transformations.map(transformation => (
                    <SelectItem key={transformation.id} value={transformation.id}>
                      {transformation.title || transformation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={onCreateInsight}
                disabled={!selectedTransformation || creatingInsight}
              >
                {creatingInsight ? (
                  <>
                    <LoadingSpinner className="size-3" />
                    {t('common.creating')}
                  </>
                ) : (
                  <>
                    <Plus className="size-4" />
                    {t('common.create')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {loadingInsights ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : insights.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Lightbulb className="mx-auto mb-3 size-12 opacity-50" />
            <p className="text-sm">{t('sources.noInsightsYet')}</p>
            {canEdit && <p className="mt-1 text-xs">{t('sources.createFirstInsight')}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {insights.map(insight => (
              <article key={insight.id} className="border bg-background p-4">
                <Badge variant="outline" className="text-xs uppercase">
                  {insight.insight_type}
                </Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  {insight.content.slice(0, 180)}{insight.content.length > 180 ? '…' : ''}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => onViewInsight(insight)}>
                    {t('sources.viewInsight')}
                  </Button>
                  {canEdit && (
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => onDeleteInsight(insight.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <span className="sr-only">{t('common.delete')}</span>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
