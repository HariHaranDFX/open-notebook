import type { NextRequest } from 'next/server'

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:5055'

export async function sseProxy(req: NextRequest, upstreamPath: string) {
  const body = await req.text()

  // Forward the browser's auth AND CSRF-relevant headers so this streaming
  // request authenticates and passes the backend's CSRF origin check the same
  // way ordinary (rewrite-proxied) requests do. Password mode uses the bearer
  // token; Entra mode uses the session cookie and needs Origin/Referer to match
  // CORS_ORIGINS — without them the backend rejects the write with 403 (see
  // api/auth/csrf.py). The default Next rewrite forwards these; this custom SSE
  // proxy must too.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  for (const name of ['authorization', 'cookie', 'origin', 'referer']) {
    const value = req.headers.get(name)
    if (value) headers[name] = value
  }

  const upstream = await fetch(`${INTERNAL_API_URL}${upstreamPath}`, {
    method: 'POST',
    headers,
    body,
    cache: 'no-store',
  })

  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
