'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/common/EmptyState'
import { AlertCircle, ArrowLeft, Check, Copy, FileQuestion, Loader2, Play, RefreshCcw } from 'lucide-react'
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
  const [copied, setCopied] = useState(false)

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

    try {
      const result = await executeTransformation.mutateAsync({
        transformation_id: selectedId,
        input_text: inputText,
        model_id: modelId,
      })
      setOutput(result.output)
    } catch {
      // Failure is surfaced inline via executeTransformation.isError (and the
      // hook's toast); clear any stale output so the error state is unambiguous.
      setOutput('')
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const canExecute = Boolean(selectedId && modelId && inputText.trim()) && !executeTransformation.isPending

  if (notFound) {
    return (
      <div className="rounded-[var(--surface-radius)] border border-dashed bg-muted/30 py-12">
        <EmptyState
          icon={FileQuestion}
          title={t('transformations.notFound')}
          description={t('transformations.notFoundDesc')}
          action={
            onBackToLibrary && (
              <Button variant="outline" onClick={onBackToLibrary}>
                <ArrowLeft className="h-4 w-4" />
                {t('transformations.backToLibrary')}
              </Button>
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-[var(--surface-radius)] border bg-card p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="transformation">{t('navigation.transformation')}</Label>
            <Select name="transformation" value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger id="transformation" className="w-full">
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

          <div className="space-y-1.5">
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

        <div className="space-y-1.5">
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

        <div className="flex justify-start">
          <Button onClick={handleExecute} disabled={!canExecute}>
            {executeTransformation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('transformations.running')}
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {t('transformations.runTest')}
              </>
            )}
          </Button>
        </div>
      </div>

      {executeTransformation.isPending ? (
        <div className="flex items-center gap-2 rounded-[var(--surface-radius)] border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('transformations.running')}
        </div>
      ) : executeTransformation.isError ? (
        <div className="space-y-3 rounded-[var(--surface-radius)] border border-destructive/40 bg-card p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{t('transformations.runError')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExecute} disabled={!canExecute}>
            <RefreshCcw className="h-4 w-4" />
            {t('common.retry')}
          </Button>
        </div>
      ) : output ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium leading-none">{t('transformations.outputLabel')}</span>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {t('transformations.copy')}
            </Button>
          </div>
          <div className="rounded-[var(--surface-radius)] border bg-card">
            <ScrollArea className="h-[400px]">
              <div className="prose prose-sm max-w-none p-4 dark:prose-invert">
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
            </ScrollArea>
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--surface-radius)] border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          {t('transformations.outputPlaceholder')}
        </div>
      )}
    </div>
  )
}
