'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowUp, Eye, MessageCircleQuestion, RotateCcw, SlidersHorizontal, Square, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/common/EmptyState'
import { ResourcePreview } from '@/components/common/ResourcePreview'
import { ResearchWorkbench, type WorkbenchPane } from '@/components/workbench/ResearchWorkbench'
import { StreamingResponse } from './StreamingResponse'
import { AdvancedModelsDialog } from './AdvancedModelsDialog'
import { SaveToNotebooksDialog } from './SaveToNotebooksDialog'
import { useAsk } from '@/lib/hooks/use-ask'
import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useResourcePreview } from '@/lib/hooks/use-resource-preview'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useWorkbenchStore } from '@/lib/stores/workbench-store'

// Must match the workspaceKey passed to ResearchWorkbench below.
const ASK_WORKSPACE_KEY = 'knowledge:ask'

interface AskWorkspaceProps {
  initialQuestion?: string
}

type ModelSet = { strategy: string; answer: string; finalAnswer: string }

/**
 * Ask workspace on the research workbench: the chat region holds the question
 * composer and streaming synthesis (with cancel / retry / save); the panel holds
 * the resource preview that citations open into — so the answer is never lost.
 */
export function AskWorkspace({ initialQuestion = '' }: AskWorkspaceProps) {
  const { t } = useTranslation()
  const ask = useAsk()
  const { data: modelDefaults } = useModelDefaults()
  const { data: availableModels } = useModels()
  const preview = useResourcePreview()
  const setActivePane = useWorkbenchStore(s => s.setActivePane)
  const setMobileView = useWorkbenchStore(s => s.setMobileView)

  const [question, setQuestion] = useState(initialQuestion)
  const [customModels, setCustomModels] = useState<ModelSet | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showSave, setShowSave] = useState(false)

  const hasEmbeddingModel = !!modelDefaults?.default_embedding_model
  const defaultChat = modelDefaults?.default_chat_model

  const modelNameById = useMemo(
    () => new Map((availableModels ?? []).map(m => [m.id, m.name])),
    [availableModels]
  )
  const resolveModelName = (id?: string | null) => (id ? modelNameById.get(id) ?? id : t('searchPage.notSet'))

  const models: ModelSet | null =
    customModels ?? (defaultChat ? { strategy: defaultChat, answer: defaultChat, finalAnswer: defaultChat } : null)

  // One honest summary for the footer's "Models" chip: the model name when all
  // three pipeline steps share it, otherwise "Custom".
  const modelSummary = models
    ? (models.strategy === models.answer && models.answer === models.finalAnswer
        ? resolveModelName(models.strategy)
        : t('common.custom'))
    : t('searchPage.notSet')

  const submit = (q: string) => {
    if (!q.trim() || !models) return
    void ask.sendAsk(q, models)
  }

  // Auto-run once when arriving with a deep-linked question.
  const autoRanRef = useRef<string | null>(null)
  useEffect(() => {
    if (initialQuestion && autoRanRef.current !== initialQuestion && models) {
      autoRanRef.current = initialQuestion
      setQuestion(initialQuestion)
      void ask.sendAsk(initialQuestion, models)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, defaultChat])

  const hasOutput = ask.isStreaming || ask.strategy || ask.answers.length > 0 || Boolean(ask.finalAnswer)
  const canRetry = !ask.isStreaming && (ask.cancelled || Boolean(ask.error))

  // Narrow the loosely-typed reference click to a preview resource, open it, and
  // surface the preview pane — on a compact layout the panel is a tab, so also
  // switch to it (and back on the next reference) instead of leaving it hidden.
  const openReference = (type: string, id: string) => {
    if (type === 'source' || type === 'note' || type === 'source_insight') {
      preview.openPreview(type, id)
      setActivePane(ASK_WORKSPACE_KEY, 'preview')
      setMobileView(ASK_WORKSPACE_KEY, 'panel')
    }
  }

  const chat = (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!hasEmbeddingModel ? (
          <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
            <AlertCircle className="size-4" aria-hidden="true" />
            {t('searchPage.noEmbeddingModel')}
          </p>
        ) : hasOutput ? (
          <StreamingResponse
            isStreaming={ask.isStreaming}
            strategy={ask.strategy}
            answers={ask.answers}
            finalAnswer={ask.finalAnswer}
            onReferenceClick={openReference}
            onSave={() => setShowSave(true)}
          />
        ) : (
          <EmptyState
            icon={MessageCircleQuestion}
            title={t('searchPage.askYourKb')}
            description={t('searchPage.askYourKbDesc')}
          />
        )}
      </div>

      {/* Full-width composer bar (no enclosing box): the question field spans the
          panel, with the model control and the Ask / Stop / Retry actions beneath.
          The field's focus ring stays within the p-4 padding, so it never spills
          outside the panel. */}
      <div className="flex-shrink-0 space-y-2 border-t border-border p-4">
        <Label htmlFor="ask-question" className="sr-only">{t('searchPage.question')}</Label>
        <Textarea
          id="ask-question"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !ask.isStreaming) {
              e.preventDefault()
              submit(question)
            }
          }}
          placeholder={t('searchPage.enterQuestionPlaceholder')}
          aria-label={t('common.accessibility.enterQuestion')}
          disabled={ask.isStreaming || !hasEmbeddingModel}
          rows={1}
          className="max-h-[160px] min-h-[44px] w-full resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => setShowAdvanced(true)}
            disabled={ask.isStreaming || !hasEmbeddingModel}
          >
            <SlidersHorizontal className="size-3.5" />
            {t('common.models')} · {modelSummary}
          </Button>
          <div className="flex items-center gap-1.5">
            {canRetry && !ask.isStreaming && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void ask.retry()}>
                <RotateCcw className="size-3.5" />
                {t('common.retry')}
              </Button>
            )}
            {ask.isStreaming ? (
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={ask.cancel}>
                <Square className="size-3.5" />
                {t('common.cancel')}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => submit(question)}
                disabled={!question.trim() || !hasEmbeddingModel || !models}
              >
                {t('searchPage.ask')}
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const previewOpen = Boolean(preview.type && preview.id)
  const panes: WorkbenchPane[] = [
    {
      id: 'preview',
      label: t('common.preview'),
      icon: Eye,
      // Close lives in the tab bar so the preview pane isn't double-headed.
      action: previewOpen ? (
        <Button variant="ghost" size="icon-sm" onClick={preview.closePreview} aria-label={t('common.close')}>
          <X className="size-4" />
        </Button>
      ) : undefined,
      content: (
        <div className="absolute inset-0 min-h-0 bg-card">
          {preview.type && preview.id ? (
            <ResourcePreview type={preview.type} id={preview.id} onClose={preview.closePreview} showHeader={false} />
          ) : (
            <EmptyState icon={Eye} title={t('common.preview')} />
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <ResearchWorkbench workspaceKey={ASK_WORKSPACE_KEY} panes={panes} panelLabel={t('common.preview')} chat={chat} />

      <AdvancedModelsDialog
        open={showAdvanced}
        onOpenChange={setShowAdvanced}
        defaultModels={{
          strategy: models?.strategy || '',
          answer: models?.answer || '',
          finalAnswer: models?.finalAnswer || '',
        }}
        onSave={setCustomModels}
      />

      {ask.finalAnswer && (
        <SaveToNotebooksDialog open={showSave} onOpenChange={setShowSave} question={question} answer={ask.finalAnswer} />
      )}
    </>
  )
}
