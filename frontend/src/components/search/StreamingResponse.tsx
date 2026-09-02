'use client'

import { useState } from 'react'
import { CheckCircle, Sparkles, Lightbulb, ChevronDown, Copy, Check, Save } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { buildCompactReferences } from '@/lib/utils/source-references'
import { ChatReferences, createReferenceCitationComponent } from '@/components/sources/ChatReferences'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface StrategyData {
  reasoning: string
  searches: Array<{ term: string; instructions: string }>
}

interface StreamingResponseProps {
  isStreaming: boolean
  strategy: StrategyData | null
  answers: string[]
  finalAnswer: string | null
  // References open through this handler (e.g. into the preview pane) instead of
  // the default modal, so the answer isn't discarded.
  onReferenceClick?: (type: string, id: string) => void
  // Save the finished answer (opens the save-to-notebooks flow owned by the parent).
  onSave?: () => void
}

export function StreamingResponse({
  isStreaming,
  strategy,
  answers,
  finalAnswer,
  onReferenceClick,
  onSave,
}: StreamingResponseProps) {
  const { t } = useTranslation()
  const { openModal } = useModalManager()
  const [strategyOpen, setStrategyOpen] = useState(false)
  const [answersOpen, setAnswersOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleReferenceClick = onReferenceClick ?? ((type: string, id: string) => {
    const modalType = type === 'source_insight' ? 'insight' : type as 'source' | 'note' | 'insight'
    try {
      openModal(modalType, id)
    } catch {
      const typeLabel = type === 'source_insight' ? 'insight' : type
      toast.error(t('common.itemNotFound', { type: typeLabel }))
    }
  })

  const handleCopy = async () => {
    if (!finalAnswer) return
    try {
      await navigator.clipboard.writeText(finalAnswer)
      setCopied(true)
      toast.success(t('common.copyToClipboard'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked — nothing to recover; the answer is still on screen.
    }
  }

  if (!strategy && !answers.length && !finalAnswer && !isStreaming) {
    return null
  }

  return (
    <div
      className="space-y-3"
      role="region"
      aria-label={t('common.accessibility.askResponse')}
      aria-live="polite"
      aria-busy={isStreaming}
    >
      {/* Progress — a legible trail while the answer is still forming */}
      {isStreaming && !finalAnswer && (
        <AskProgress hasStrategy={Boolean(strategy)} answerCount={answers.length} />
      )}

      {/* Strategy — a quiet, collapsed "how it planned" disclosure */}
      {strategy && (
        <Collapsible open={strategyOpen} onOpenChange={setStrategyOpen}>
          <div className="overflow-hidden rounded-[var(--surface-radius)] border border-border bg-muted/40">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <span className="flex items-center gap-2 font-medium">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                {t('common.strategy')}
              </span>
              <ChevronDown className={cn('size-4 shrink-0 transition-transform', strategyOpen && 'rotate-180')} aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 border-t border-border/60 px-3 pb-3 pt-2.5">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">{t('common.reasoning')}: </span>
                  {strategy.reasoning}
                </p>
                {strategy.searches.length > 0 && (
                  <div className="space-y-2">
                    {strategy.searches.map((search, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Badge variant="outline" className="mt-0.5 tabular-nums">{i + 1}</Badge>
                        <div className="min-w-0">
                          <p className="text-xs font-medium">{search.term}</p>
                          <p className="text-xs text-muted-foreground">{search.instructions}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Intermediate answers — a second quiet disclosure */}
      {answers.length > 0 && (
        <Collapsible open={answersOpen} onOpenChange={setAnswersOpen}>
          <div className="overflow-hidden rounded-[var(--surface-radius)] border border-border bg-muted/40">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <span className="flex items-center gap-2 font-medium">
                <Lightbulb className="size-4 text-amber-500" aria-hidden="true" />
                {t('common.individualAnswers', { count: answers.length })}
              </span>
              <ChevronDown className={cn('size-4 shrink-0 transition-transform', answersOpen && 'rotate-180')} aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border/60 border-t border-border/60 px-3">
                {answers.map((answer, i) => (
                  <p key={i} className="py-2.5 text-xs leading-relaxed text-muted-foreground">{answer}</p>
                ))}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Final answer — the hero */}
      {finalAnswer && (
        <article className="relative overflow-hidden rounded-[var(--surface-radius)] border border-border bg-card p-4 pl-5 shadow-sm">
          <span aria-hidden="true" className="absolute inset-y-4 left-0 w-[3px] rounded-full bg-primary" />
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary">
            <CheckCircle className="size-4" aria-hidden="true" />
            {t('common.finalAnswer')}
          </div>
          <FinalAnswerContent content={finalAnswer} onReferenceClick={handleReferenceClick} />
          <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-2.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={handleCopy}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {t('common.copyToClipboard')}
            </Button>
            {onSave && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={onSave}
              >
                <Save className="size-3.5" />
                {t('searchPage.saveToNotebooks')}
              </Button>
            )}
          </div>
        </article>
      )}
    </div>
  )
}

// Plan → Search → Answer progress, derived from the streamed state.
function AskProgress({ hasStrategy, answerCount }: { hasStrategy: boolean; answerCount: number }) {
  const { t } = useTranslation()
  const searchDone = answerCount > 0
  const steps = [
    { label: t('common.strategy'), done: hasStrategy, active: !hasStrategy },
    { label: t('searchPage.search'), done: searchDone, active: hasStrategy && !searchDone },
    { label: t('common.finalAnswer'), done: false, active: searchDone },
  ]

  return (
    <div className="flex items-center gap-1.5 text-xs" aria-hidden="true">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className={cn('h-px w-4 sm:w-6', steps[i - 1].done ? 'bg-primary/60' : 'bg-border')} />
          )}
          <span
            className={cn(
              'inline-flex items-center gap-1.5',
              step.active ? 'font-medium text-foreground' : step.done ? 'text-muted-foreground' : 'text-muted-foreground/50'
            )}
          >
            <span
              className={cn(
                'flex size-4 items-center justify-center rounded-full border',
                step.done ? 'border-primary bg-primary text-primary-foreground'
                  : step.active ? 'border-primary text-primary' : 'border-border'
              )}
            >
              {step.done ? (
                <Check className="size-2.5" />
              ) : step.active ? (
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              ) : null}
            </span>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// Renders the final answer with compact numbered citations (serif reading
// measure) and a typed reference footer — the same provenance model as chat.
function FinalAnswerContent({
  content,
  onReferenceClick,
}: {
  content: string
  onReferenceClick: (type: string, id: string) => void
}) {
  const { markdown, references } = buildCompactReferences(content)
  const LinkComponent = createReferenceCitationComponent(onReferenceClick)

  return (
    <>
      <div className="max-w-[68ch] text-[15px] leading-relaxed">
        <MarkdownRenderer components={{ a: LinkComponent }}>
          {markdown}
        </MarkdownRenderer>
      </div>
      <ChatReferences references={references} onReferenceClick={onReferenceClick} />
    </>
  )
}
