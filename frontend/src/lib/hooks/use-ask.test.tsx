/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAsk } from './use-ask'
import { searchApi } from '@/lib/api/search'
import { toast } from 'sonner'

// useTranslation is mocked globally in setup.ts (t returns the key string).
vi.mock('@/lib/api/search', () => ({ searchApi: { askKnowledgeBase: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const models = { strategy: 'm1', answer: 'm2', finalAnswer: 'm3' }

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

beforeEach(() => {
  vi.mocked(searchApi.askKnowledgeBase).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('useAsk', () => {
  it('assembles strategy and final answer from SSE lines split across chunks', async () => {
    vi.mocked(searchApi.askKnowledgeBase).mockResolvedValue(
      streamFrom([
        'data: {"type":"strat',
        'egy","reasoning":"r","searches":[]}\n',
        'data: {"type":"final_answer","content":"Hi"}\n',
      ])
    )
    const { result } = renderHook(() => useAsk())

    await act(async () => {
      await result.current.sendAsk('q', models)
    })

    expect(result.current.strategy?.reasoning).toBe('r')
    expect(result.current.finalAnswer).toBe('Hi')
    expect(result.current.isStreaming).toBe(false)
  })

  it('parses a complete final line left in the buffer without a trailing newline', async () => {
    vi.mocked(searchApi.askKnowledgeBase).mockResolvedValue(
      streamFrom(['data: {"type":"final_answer","content":"Bye"}'])
    )
    const { result } = renderHook(() => useAsk())

    await act(async () => {
      await result.current.sendAsk('q', models)
    })

    expect(result.current.finalAnswer).toBe('Bye')
  })

  it('surfaces a server error event with an error toast', async () => {
    vi.mocked(searchApi.askKnowledgeBase).mockResolvedValue(
      streamFrom(['data: {"type":"error","message":"boom"}\n'])
    )
    const { result } = renderHook(() => useAsk())

    await act(async () => {
      await result.current.sendAsk('q', models)
    })

    expect(result.current.error).toBe('apiErrors.askFailed')
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.cancelled).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })

  it('marks the request cancelled without an error toast when aborted', async () => {
    vi.mocked(searchApi.askKnowledgeBase).mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    )
    const { result } = renderHook(() => useAsk())

    await act(async () => {
      await result.current.sendAsk('q', models)
    })

    expect(result.current.cancelled).toBe(true)
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.error).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('retry re-runs the last question and models', async () => {
    vi.mocked(searchApi.askKnowledgeBase)
      .mockResolvedValueOnce(streamFrom(['data: {"type":"complete"}\n']))
      .mockResolvedValueOnce(streamFrom(['data: {"type":"complete"}\n']))
    const { result } = renderHook(() => useAsk())

    await act(async () => {
      await result.current.sendAsk('the question', models)
    })
    await act(async () => {
      await result.current.retry()
    })

    expect(searchApi.askKnowledgeBase).toHaveBeenCalledTimes(2)
    expect(vi.mocked(searchApi.askKnowledgeBase).mock.calls[1][0]).toMatchObject({
      question: 'the question',
      strategy_model: 'm1',
      answer_model: 'm2',
      final_answer_model: 'm3',
    })
  })

  it('aborts the previous request when a new one starts', async () => {
    const signals: (AbortSignal | undefined)[] = []
    vi.mocked(searchApi.askKnowledgeBase).mockImplementation(async (_params, signal) => {
      signals.push(signal)
      return streamFrom(['data: {"type":"complete"}\n'])
    })
    const { result } = renderHook(() => useAsk())

    await act(async () => {
      await result.current.sendAsk('q1', models)
    })
    await act(async () => {
      await result.current.sendAsk('q2', models)
    })

    expect(signals[0]?.aborted).toBe(true)
  })

  // Backport of upstream lfnovo/open-notebook#1146 — dangling connections
  // (Docker proxy leaves the socket open past `done`) left the spinner
  // stuck forever. The idle watchdog aborts and clears isStreaming when no
  // chunk arrives for STREAM_IDLE_TIMEOUT_MS (aligned to axios timeout).
  it('aborts and clears isStreaming when the stream goes idle past the watchdog', async () => {
    vi.useFakeTimers()
    try {
      let capturedSignal: AbortSignal | undefined
      // Stream that opens but never emits. A real fetch would wire the
      // AbortSignal into its response body; here we mimic that so aborting
      // the controller propagates as an error to the reader.
      vi.mocked(searchApi.askKnowledgeBase).mockImplementation(async (_p, signal) => {
        capturedSignal = signal
        return new ReadableStream<Uint8Array>({
          start(streamController) {
            signal?.addEventListener('abort', () => {
              streamController.error(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              )
            })
          },
        })
      })

      const { result } = renderHook(() => useAsk())

      // Kick off the request; don't await — it never resolves until the
      // watchdog fires. Advance fake timers past the idle window.
      let sendPromise: Promise<void>
      await act(async () => {
        sendPromise = result.current.sendAsk('q', models)
      })
      expect(result.current.isStreaming).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000 + 100)
      })
      await act(async () => {
        await sendPromise!
      })

      expect(capturedSignal?.aborted).toBe(true)
      expect(result.current.isStreaming).toBe(false)
      expect(result.current.cancelled).toBe(true)
      expect(toast.error).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
