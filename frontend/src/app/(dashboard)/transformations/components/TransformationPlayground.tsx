'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/common/EmptyState'
import { ArrowLeft, FileQuestion, Play, Loader2 } from 'lucide-react'
import { Transformation } from '@/lib/types/transformations'
import { useExecuteTransformation } from '@/lib/hooks/use-transformations'
import { ModelSelector } from '@/components/common/ModelSelector'
import { useTranslation } from '@/lib/hooks/use-translation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

interface TransformationPlaygroundProps {
  transformations: Transformation[] | undefined
  /** Raw `?transformation=` id from the URL, resolved against `transformations` below. */
  selectedTransformationId?: string | null
  onBackToLibrary?: () => void
}

export function TransformationPlayground({
  transformations,
  selectedTransformationId,
  onBackToLibrary,
}: TransformationPlaygroundProps) {
  const { t } = useTranslation()
  const activeTransformations = transformations?.filter((transformation) => !transformation.deleted_at)
  const resolvedTransformation = selectedTransformationId
    ? activeTransformations?.find((transformation) => transformation.id === selectedTransformationId)
    : undefined
  // Only flag "not found" once the list has actually loaded (transformations
  // is an array, not undefined) — otherwise every fresh load would flash the
  // not-found state before the fetch resolves.
  const notFound = Boolean(selectedTransformationId) && Array.isArray(transformations) && !resolvedTransformation

  const [selectedId, setSelectedId] = useState(selectedTransformationId || '')
  const [inputText, setInputText] = useState('')
  const [modelId, setModelId] = useState('')
  const [output, setOutput] = useState('')

  const executeTransformation = useExecuteTransformation()

  // Restore the selection once the transformation list (re)loads — e.g. on
  // a hard reload of ?view=playground&transformation=<id>.
  useEffect(() => {
    if (resolvedTransformation) {
      setSelectedId(resolvedTransformation.id)
    }
  }, [resolvedTransformation])

  const handleExecute = async () => {
    if (!selectedId || !modelId || !inputText.trim()) {
      return
    }

    const result = await executeTransformation.mutateAsync({
      transformation_id: selectedId,
      input_text: inputText,
      model_id: modelId
    })

    setOutput(result.output)
  }

  const canExecute = selectedId && modelId && inputText.trim() && !executeTransformation.isPending

  if (notFound) {
    return (
      <Card>
        <CardContent className="py-12">
          <EmptyState
            icon={FileQuestion}
            title={t('transformations.notFound')}
            description={t('transformations.notFoundDesc')}
            action={
              onBackToLibrary && (
                <Button variant="outline" onClick={onBackToLibrary}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {t('transformations.backToLibrary')}
                </Button>
              )
            }
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('transformations.playground')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="transformation">{t('navigation.transformation')}</Label>
              <Select name="transformation" value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger id="transformation">
                  <SelectValue placeholder={t('transformations.selectToStart')} />
                </SelectTrigger>
                <SelectContent>
                  {activeTransformations?.map((transformation) => (
                    <SelectItem key={transformation.id} value={transformation.id}>
                      {transformation.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <ModelSelector
                label={t('transformations.model')}
                name="model"
                modelType="language"
                value={modelId}
                onChange={setModelId}
                placeholder={t('transformations.selectModel')}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="input">{t('transformations.inputLabel')}</Label>
            <Textarea
              id="input"
              name="input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t('transformations.inputPlaceholder')}
              rows={8}
              className="font-mono text-sm"
            />
          </div>

          <div className="flex justify-center">
            <Button 
              onClick={handleExecute}
              disabled={!canExecute}
              size="lg"
            >
              {executeTransformation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('transformations.running')}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  {t('transformations.runTest')}
                </>
              )}
            </Button>
          </div>

          {output && (
            <div className="space-y-2">
              <span className="text-sm font-medium leading-none">{t('transformations.outputLabel')}</span>
              <Card>
                <ScrollArea className="h-[400px]">
                  <CardContent className="pt-6">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          table: ({ children }) => (
                            <div className="my-4 overflow-x-auto">
                              <table className="min-w-full border-collapse border border-border">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
                          tbody: ({ children }) => <tbody>{children}</tbody>,
                          tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
                          th: ({ children }) => <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>,
                          td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
                        }}
                      >
                        {output}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                </ScrollArea>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}