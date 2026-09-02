'use client'

import { useRef } from 'react'

import {
  DEFAULT_LEFT_PANEL_WIDTH,
  MAX_LEFT_PANEL_WIDTH,
  MIN_LEFT_PANEL_WIDTH,
  clampLeftPanelWidth,
} from '@/lib/stores/workbench-store'

interface PaneResizerProps {
  width: number
  leftLabel: string
  rightLabel: string
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
}

export function PaneResizer({
  width,
  leftLabel,
  rightLabel,
  onResize,
  onResizeEnd,
}: PaneResizerProps) {
  const drag = useRef<{ startX: number; width: number } | null>(null)
  const latest = useRef(width)
  latest.current = width

  const update = (next: number, commit = false) => {
    latest.current = clampLeftPanelWidth(next)
    onResize(latest.current)
    if (commit) onResizeEnd(latest.current)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`${leftLabel} / ${rightLabel}`}
      aria-orientation="vertical"
      aria-valuemin={MIN_LEFT_PANEL_WIDTH}
      aria-valuemax={MAX_LEFT_PANEL_WIDTH}
      aria-valuenow={Math.round(width)}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      className="group relative z-10 w-1.5 shrink-0 touch-none cursor-col-resize bg-muted outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-3 before:-translate-x-1/2 before:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onPointerDown={event => {
        drag.current = { startX: event.clientX, width }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (!drag.current) return
        update(drag.current.width + event.clientX - drag.current.startX)
      }}
      onPointerUp={event => {
        if (!drag.current) return
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        onResizeEnd(latest.current)
      }}
      onPointerCancel={() => {
        drag.current = null
        onResizeEnd(latest.current)
      }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home'
          ? DEFAULT_LEFT_PANEL_WIDTH
          : event.key === 'End'
            ? MAX_LEFT_PANEL_WIDTH
            : width + (event.key === 'ArrowLeft' ? -16 : 16)
        update(next, true)
      }}
    >
      <span
        data-testid="pane-resizer-grip"
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-7 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong transition-colors duration-[var(--motion-standard)] group-hover:bg-primary group-focus-visible:bg-primary group-active:bg-primary"
      />
    </div>
  )
}
