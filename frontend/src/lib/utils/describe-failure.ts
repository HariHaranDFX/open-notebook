/**
 * Turns a stored worker or provider error into a sentence a person can read.
 * A short message is kept. A status envelope keeps only its inner message.
 * Anything that is still a traceback, record id, or path becomes a short key.
 */

const MESSAGE_FIELD = /['"]message['"]\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/

function extractProviderMessage(raw: string): string | null {
  const match = raw.match(MESSAGE_FIELD)
  if (!match?.[2]) return null
  const text = match[2].replace(/\\'/g, "'").replace(/\\"/g, '"').trim()
  return text || null
}

function looksTechnical(value: string): boolean {
  return (
    value.includes('{') ||
    value.includes('}') ||
    value.includes('Traceback') ||
    value.includes('site-packages') ||
    value.includes('File "') ||
    value.includes('/tmp/') ||
    /[A-Za-z]:\\/.test(value) ||
    /\b(?:model|user|source|command|notebook):[a-z0-9]+\b/i.test(value) ||
    /^[A-Za-z]+(?:Error|Exception)\b/.test(value) ||
    /^\d{3}\b/.test(value) ||
    value.length > 400
  )
}

function categoryKey(value: string): string | null {
  const lower = value.toLowerCase()
  if (
    lower.includes('high demand') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    /\b503\b/.test(lower)
  ) {
    return 'apiErrors.modelBusy'
  }
  if (
    (lower.includes('rate') && lower.includes('limit')) ||
    lower.includes('quota') ||
    lower.includes('resource exhausted') ||
    /\b429\b/.test(lower)
  ) {
    return 'apiErrors.rateLimited'
  }
  if (
    (lower.includes('not found') || lower.includes('not_found')) &&
    lower.includes('model')
  ) {
    return 'apiErrors.modelUnavailable'
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'apiErrors.modelTimeout'
  }
  return null
}

export function describeFailure(
  raw: string | null | undefined,
  t: (key: string) => string,
): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null

  const stripped = trimmed.replace(/^(?:[A-Za-z]+(?:Error|Exception): )+/, '')
  const extracted = extractProviderMessage(trimmed) ?? extractProviderMessage(stripped)
  if (extracted && !looksTechnical(extracted)) return extracted

  const body = stripped.trim()
  if (body && !looksTechnical(body)) return body

  const key = categoryKey(extracted ?? body) ?? categoryKey(trimmed) ?? 'apiErrors.genericError'
  return t(key)
}
