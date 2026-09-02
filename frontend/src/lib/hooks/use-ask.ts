'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { searchApi } from '@/lib/api/search'
import { AskStreamEvent } from '@/lib/types/search'

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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

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

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last incomplete line in the buffer.
        buffer = lines.pop() || ''
        for (const line of lines) processLine(line)
      }

      // A complete final line may arrive without a trailing newline.
      if (buffer.trim()) processLine(buffer)

      update(prev => ({ ...prev, isStreaming: false }))
    } catch (error) {
      const err = error as { name?: string; message?: string }

      // Cancelled (explicit cancel or superseded) — preserve partial output,
      // no error toast. Superseded requests are filtered out by `update`.
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
  }, [t])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const retry = useCallback(async () => {
    const last = lastRequestRef.current
    if (last) await sendAsk(last.question, last.models)
  }, [sendAsk])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    setState(INITIAL_STATE)
  }, [])

  return { ...state, sendAsk, cancel, retry, reset }
}
