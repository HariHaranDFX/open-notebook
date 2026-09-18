'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { searchApi } from '@/lib/api/search'
import { AskStreamEvent } from '@/lib/types/search'
import { API_TIMEOUT_MS } from '@/lib/api/client'

// Idle watchdog for the SSE stream: if no bytes arrive for this long, treat
// the connection as dangling (Docker/proxy leaves it open without propagating
// the `done` signal), abort the socket and end the loading state. Aligned to
// the same budget as axios so slow local models (Ollama, LM Studio) that
// legitimately take a while between events aren't cut off. `0` disables it.
// Re-armed on every received chunk — idle, not wall-clock.
const STREAM_IDLE_TIMEOUT_MS = API_TIMEOUT_MS

interface AskModels {
  strategy: string
  answer: string
  finalAnswer: string
}

interface StrategyData {
  reasoning: string
  searches: Array<{ term: string; instructions: string }>
}

interface AskState {
  isStreaming: boolean
  strategy: StrategyData | null
  answers: string[]
  finalAnswer: string | null
  error: string | null
  cancelled: boolean
}

export interface UseAskResult extends AskState {
  sendAsk: (question: string, models: AskModels) => Promise<void>
  cancel: () => void
  retry: () => Promise<void>
  reset: () => void
}

const INITIAL_STATE: AskState = {
  isStreaming: false,
  strategy: null,
  answers: [],
  finalAnswer: null,
  error: null,
  cancelled: false,
}

export function useAsk(): UseAskResult {
  const { t } = useTranslation()
  const [state, setState] = useState<AskState>(INITIAL_STATE)

  const controllerRef = useRef<AbortController | null>(null)
  const lastRequestRef = useRef<{ question: string; models: AskModels } | null>(null)
  const mountedRef = useRef(true)
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearStreamTimeout = useCallback(() => {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
      streamTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearStreamTimeout()
      controllerRef.current?.abort()
    }
  }, [clearStreamTimeout])

  const sendAsk = useCallback(async (question: string, models: AskModels) => {
    if (!question.trim()) {
      toast.error(t('apiErrors.pleaseEnterQuestion'))
      return
    }
    if (!models.strategy || !models.answer || !models.finalAnswer) {
      toast.error(t('apiErrors.pleaseConfigureModels'))
      return
    }

    lastRequestRef.current = { question, models }

    // Supersede any in-flight request before starting a new one.
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    // Only the current request may touch state; a superseded request's late
    // events (including its AbortError) must not clobber the newer one.
    const update = (fn: (prev: AskState) => AskState) => {
      if (mountedRef.current && controllerRef.current === controller) setState(fn)
    }

    setState({ ...INITIAL_STATE, isStreaming: true })

    // Arm/re-arm the idle watchdog against THIS controller. If a superseded
    // request's timer fires later, controllerRef.current will have moved on
    // and we don't touch anything.
    const armStreamTimeout = () => {
      clearStreamTimeout()
      if (STREAM_IDLE_TIMEOUT_MS <= 0) return
      streamTimeoutRef.current = setTimeout(() => {
        if (controllerRef.current !== controller) return
        controller.abort()
        update(prev => (prev.isStreaming ? { ...prev, isStreaming: false } : prev))
      }, STREAM_IDLE_TIMEOUT_MS)
    }
    armStreamTimeout()

    const processLine = (line: string) => {
      if (!line.startsWith('data: ')) return
      const jsonStr = line.slice(6).trim()
      if (!jsonStr) return

      let data: AskStreamEvent
      try {
        data = JSON.parse(jsonStr)
      } catch (e) {
        // Incomplete or malformed JSON is skipped, not fatal.
        if (e instanceof SyntaxError) {
          console.error('Error parsing SSE data:', e, 'Line:', line)
          return
        }
        throw e
      }

      if (data.type === 'strategy') {
        update(prev => ({ ...prev, strategy: { reasoning: data.reasoning || '', searches: data.searches || [] } }))
      } else if (data.type === 'answer') {
        update(prev => ({ ...prev, answers: [...prev.answers, data.content || ''] }))
      } else if (data.type === 'final_answer') {
        update(prev => ({ ...prev, finalAnswer: data.content || '', isStreaming: false }))
      } else if (data.type === 'complete') {
        update(prev => ({ ...prev, isStreaming: false }))
      } else if (data.type === 'error') {
        throw new Error(data.message || 'Stream error occurred')
      }
    }

    try {
      const response = await searchApi.askKnowledgeBase(
        {
          question,
          strategy_model: models.strategy,
          answer_model: models.answer,
          final_answer_model: models.finalAnswer,
        },
        controller.signal
      )

      if (!response) {
        throw new Error('No response body received from server')
      }

      const reader = response.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Re-arm the idle watchdog on every received chunk — silence, not
        // wall-clock, is what indicates a dangling connection.
        armStreamTimeout()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last incomplete line in the buffer.
        buffer = lines.pop() || ''
        for (const line of lines) processLine(line)
      }

      // A complete final line may arrive without a trailing newline.
      if (buffer.trim()) processLine(buffer)

      clearStreamTimeout()
      update(prev => ({ ...prev, isStreaming: false }))
    } catch (error) {
      clearStreamTimeout()
      const err = error as { name?: string; message?: string }

      // Cancelled (explicit cancel, superseded, or watchdog abort) — preserve
      // partial output, no error toast. Superseded requests are filtered by
      // `update`; the watchdog already set isStreaming=false before aborting.
      if (err?.name === 'AbortError') {
        update(prev => ({ ...prev, isStreaming: false, cancelled: true }))
        return
      }

      console.error('Ask error:', error)
      update(prev => ({ ...prev, isStreaming: false, error: t('apiErrors.askFailed') }))
      if (mountedRef.current && controllerRef.current === controller) {
        toast.error(t('apiErrors.askFailed'), {
          description: getApiErrorMessage(error, (key) => t(key), 'apiErrors.askFailed'),
        })
      }
    }
  }, [t, clearStreamTimeout])

  const cancel = useCallback(() => {
    clearStreamTimeout()
    controllerRef.current?.abort()
  }, [clearStreamTimeout])

  const retry = useCallback(async () => {
    const last = lastRequestRef.current
    if (last) await sendAsk(last.question, last.models)
  }, [sendAsk])

  const reset = useCallback(() => {
    clearStreamTimeout()
    controllerRef.current?.abort()
    setState(INITIAL_STATE)
  }, [clearStreamTimeout])

  return { ...state, sendAsk, cancel, retry, reset }
}
