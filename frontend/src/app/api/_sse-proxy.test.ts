/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sseProxy } from './_sse-proxy'

function mockReq(headers: Record<string, string>) {
  return {
    text: async () => '{}',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as any
}

describe('sseProxy', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream(),
      status: 200,
      headers: { get: () => 'text/event-stream' },
    }) as any
  })

  it('forwards auth and CSRF-relevant headers so the backend accepts the write', async () => {
    await sseProxy(
      mockReq({
        origin: 'http://localhost:3000',
        referer: 'http://localhost:3000/search',
        cookie: 'on_session=abc',
        authorization: 'Bearer t',
      }),
      '/api/search/ask'
    )

    const [, opts] = (global.fetch as any).mock.calls[0]
    expect(opts.headers.origin).toBe('http://localhost:3000')
    expect(opts.headers.referer).toBe('http://localhost:3000/search')
    expect(opts.headers.cookie).toBe('on_session=abc')
    expect(opts.headers.authorization).toBe('Bearer t')
  })

  it('omits headers that the request does not carry', async () => {
    await sseProxy(mockReq({}), '/api/search/ask')

    const [, opts] = (global.fetch as any).mock.calls[0]
    expect(opts.headers.origin).toBeUndefined()
    expect(opts.headers.authorization).toBeUndefined()
    expect(opts.headers['Content-Type']).toBe('application/json')
  })
})
