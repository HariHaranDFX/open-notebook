'use client'

import { memo, useRef, useState } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { FileText, StickyNote, Lightbulb, Quote, ChevronLeft, ChevronRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useSource } from '@/lib/hooks/use-sources'
import { useNote } from '@/lib/hooks/use-notes'
import { useInsight } from '@/lib/hooks/use-insights'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  parseReferenceHref,
  toReferenceRecordId,
  groupReferences,
  type ReferenceData,
  type ReferenceGroup,
  type ReferenceType,
} from '@/lib/utils/source-references'
import { cn } from '@/lib/utils'

type ReferenceClick = (type: ReferenceType, id: string) => void

const TYPE_META: Record<ReferenceType, { Icon: typeof FileText; iconClass: string; labelKey: string }> = {
  source: { Icon: FileText, iconClass: 'text-primary', labelKey: 'common.source' },
  note: { Icon: StickyNote, iconClass: 'text-teal-600 dark:text-teal-400', labelKey: 'common.note' },
  source_insight: { Icon: Lightbulb, iconClass: 'text-amber-600 dark:text-amber-400', labelKey: 'common.insight' },
}

// Lazily fetch just enough of the referenced item to preview it. All three
// hooks are called unconditionally (rules of hooks), but only the one matching
// the reference type — and only once its tooltip opens — actually fetches.
function useReferencePreview(type: ReferenceType, id: string, enabled: boolean) {
  // The API resolves records by their full `table:id`; references carry a bare id.
  const recordId = toReferenceRecordId(type, id)
  const source = useSource(type === 'source' ? recordId : '', { enabled: enabled && type === 'source' })
  const note = useNote(type === 'note' ? recordId : '', { enabled: enabled && type === 'note' })
  const insight = useInsight(type === 'source_insight' ? recordId : '', { enabled: enabled && type === 'source_insight' })

  const active = type === 'source' ? source : type === 'note' ? note : insight

  let title: string | null = null
  let snippet = ''
  if (type === 'source' && source.data) {
    title = source.data.title
    snippet = source.data.full_text ?? ''
  } else if (type === 'note' && note.data) {
    title = note.data.title
    snippet = note.data.content ?? ''
  } else if (type === 'source_insight' && insight.data) {
    title = insight.data.insight_type
    snippet = insight.data.content ?? ''
  }

  return { title, snippet, isLoading: active.isLoading, isError: active.isError }
}

function ReferencePreview({
  type,
  id,
  enabled,
  showType = true,
}: {
  type: ReferenceType
  id: string
  enabled: boolean
  showType?: boolean
}) {
  const { t } = useTranslation()
  const { title, snippet, isLoading, isError } = useReferencePreview(type, id, enabled)
  const { Icon, iconClass, labelKey } = TYPE_META[type]
  const cleanSnippet = snippet.replace(/\s+/g, ' ').trim().slice(0, 240)

  return (
    <div className="max-w-[260px] p-2.5 text-left">
      {showType && (
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className={cn('h-3 w-3', iconClass)} aria-hidden="true" />
          {t(labelKey)}
        </div>
      )}
      {isLoading ? (
        <div className="text-xs text-muted-foreground">{t('common.loading')}</div>
      ) : isError || (!title && !cleanSnippet) ? (
        <div className="text-xs text-muted-foreground">{t('common.noResults')}</div>
      ) : (
        <>
          {title && <div className="text-xs font-semibold leading-snug text-foreground">{title}</div>}
          {cleanSnippet && (
            <div className="mt-0.5 line-clamp-3 text-xs leading-snug text-muted-foreground">{cleanSnippet}</div>
          )}
        </>
      )}
    </div>
  )
}

// Shared tooltip content styled as a popover card (the [&>svg] rule recolours
// the tooltip arrow, which the primitive hard-codes to the primary colour).
const PREVIEW_CONTENT_CLASS =
  'border border-border bg-popover p-0 text-popover-foreground [&>svg]:bg-popover [&>svg]:fill-popover'

/** Inline citation pill rendered in place of a `[n]` marker in the answer body. */
export function ReferenceCitation({
  number,
  type,
  id,
  onReferenceClick,
}: {
  number: ReactNode
  type: ReferenceType
  id: string
  onReferenceClick: ReferenceClick
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${t(TYPE_META[type].labelKey)} ${typeof number === 'string' ? number : ''}`.trim()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onReferenceClick(type, id)
          }}
          className="mx-px inline-flex h-[15px] min-w-[16px] -translate-y-px items-center justify-center rounded-full bg-primary/10 px-1 align-baseline text-[10.5px] font-semibold leading-none tabular-nums text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {number}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className={PREVIEW_CONTENT_CLASS}>
        <ReferencePreview type={type} id={id} enabled={open} />
      </TooltipContent>
    </Tooltip>
  )
}

/** Footer chip: type icon + number, with a hover preview. */
const ReferenceChip = memo(function ReferenceChip({
  reference,
  onReferenceClick,
}: {
  reference: ReferenceData
  onReferenceClick: ReferenceClick
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { Icon, iconClass, labelKey } = TYPE_META[reference.type]

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${t(labelKey)} ${reference.number}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onReferenceClick(reference.type, reference.id)
          }}
          className="inline-flex h-6 items-center gap-1.5 rounded-[var(--pill-radius)] border border-border bg-secondary/60 pl-2 pr-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <Icon className={cn('h-3 w-3 shrink-0', iconClass)} aria-hidden="true" />
          <span className="tabular-nums text-muted-foreground">{reference.number}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className={PREVIEW_CONTENT_CLASS}>
        <ReferencePreview type={reference.type} id={reference.id} enabled={open} />
      </TooltipContent>
    </Tooltip>
  )
})

/**
 * Grouped footer pill for a type with 2+ references. Hover (or tap / focus)
 * opens a Popover that pages through the group's members in citation order.
 * The Popover — not a Tooltip — because the card holds interactive controls.
 */
const ReferenceGroupPill = memo(function ReferenceGroupPill({
  group,
  onReferenceClick,
}: {
  group: ReferenceGroup
  onReferenceClick: ReferenceClick
}) {
  const { t } = useTranslation()
  const { Icon, iconClass, labelKey } = TYPE_META[group.type]
  const typeLabel = t(labelKey)
  const count = group.members.length
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  // A short close delay bridges the gap between the trigger and the portalled
  // card so moving the pointer onto the pager arrows doesn't dismiss it.
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }
  const openNow = () => {
    cancelClose()
    setOpen(true)
  }
  const go = (delta: number) => setIndex((i) => Math.min(count - 1, Math.max(0, i + delta)))

  const current = group.members[index]

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setIndex(0)
      }}
      modal={false}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${typeLabel} (${count})`}
          onPointerEnter={openNow}
          onPointerLeave={scheduleClose}
          onKeyDown={(e) => {
            if (!open) return
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              go(1)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              go(-1)
            }
          }}
          className="inline-flex h-6 items-center gap-1.5 rounded-[var(--pill-radius)] border border-border bg-secondary/60 pl-2 pr-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <Icon className={cn('h-3 w-3 shrink-0', iconClass)} aria-hidden="true" />
          <span>{typeLabel}</span>
          <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
            {count}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-64 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Icon className={cn('h-3 w-3', iconClass)} aria-hidden="true" />
            {typeLabel}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t('common.back')}
              disabled={index === 0}
              onClick={() => go(-1)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="min-w-[2.5rem] text-center text-xs tabular-nums text-muted-foreground">
              {index + 1} / {count}
            </span>
            <button
              type="button"
              aria-label={t('common.next')}
              disabled={index === count - 1}
              onClick={() => go(1)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
        <button
          type="button"
          aria-label={`${typeLabel} ${current.number}`}
          onClick={() => {
            setOpen(false)
            onReferenceClick(current.type, current.id)
          }}
          className="block w-full text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          <div aria-live="polite">
            <ReferencePreview type={group.type} id={current.id} enabled={open} showType={false} />
          </div>
        </button>
      </PopoverContent>
    </Popover>
  )
})

/** Compact reference footer shown beneath an AI answer. Renders nothing when empty. */
export function ChatReferences({
  references,
  onReferenceClick,
}: {
  references: ReferenceData[]
  onReferenceClick: ReferenceClick
}) {
  const { t } = useTranslation()
  if (references.length === 0) return null

  // Collapse a type into a paged pill only when it has 2+ references; a lone
  // reference stays a direct, one-tap chip.
  const groups = groupReferences(references)

  return (
    <nav
      aria-label={t('common.references')}
      className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5"
    >
      <span className="mr-0.5 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Quote className="h-3 w-3" aria-hidden="true" />
        {references.length} {t('common.references')}
      </span>
      {groups.map((group) =>
        group.members.length === 1 ? (
          <ReferenceChip
            key={`${group.type}-${group.members[0].id}`}
            reference={group.members[0]}
            onReferenceClick={onReferenceClick}
          />
        ) : (
          <ReferenceGroupPill key={`group-${group.type}`} group={group} onReferenceClick={onReferenceClick} />
        )
      )}
    </nav>
  )
}

/**
 * ReactMarkdown `a` renderer that turns compact citation links (`#ref-…`) into
 * inline citation pills and leaves every other link a normal external link.
 */
export function createReferenceCitationComponent(onReferenceClick: ReferenceClick) {
  const ReferenceCitationLink = ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string; children?: ReactNode }) => {
    const ref = href ? parseReferenceHref(href) : null
    if (ref) {
      return (
        <ReferenceCitation number={children} type={ref.type} id={ref.id} onReferenceClick={onReferenceClick} />
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props} className="text-primary hover:underline">
        {children}
      </a>
    )
  }
  ReferenceCitationLink.displayName = 'ReferenceCitationLink'
  return ReferenceCitationLink
}
