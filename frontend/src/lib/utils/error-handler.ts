/**
 * Utility to map backend English error messages to i18n keys.
 */
import { isAxiosError } from 'axios'

/**
 * Returns true when the error is an HTTP 404 response, i.e. the requested
 * item was deleted or never existed (as opposed to a transient failure).
 */
export function isNotFoundError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404
}

/**
 * Returns true when the error is an HTTP 403 response, i.e. the user is
 * authenticated but not permitted to see the requested item.
 */
export function isForbiddenError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 403
}

function responseStatus(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined
}

/**
 * Utility to map backend English error messages to i18n keys.
 */
export const ERROR_MAP: Record<string, string> = {
  "Notebook not found": "apiErrors.notebookNotFound",
  "Source not found": "apiErrors.sourceNotFound",
  "Transformation not found": "apiErrors.transformationNotFound",
  "File upload failed": "apiErrors.fileUploadFailed",
  "URL is required for link type": "apiErrors.urlRequired",
  "Content is required for text type": "apiErrors.contentRequired",
  "Invalid source type": "apiErrors.invalidSourceType",
  "Processing failed": "apiErrors.processingFailed",
  "Failed to queue processing": "apiErrors.failedToQueue",
  "sort_by must be one of: type, title, created, updated, insights_count, embedded": "apiErrors.invalidSortBy",
  "sort_order must be 'asc' or 'desc'": "apiErrors.invalidSortOrder",
  "Access to file denied": "apiErrors.accessDenied",
  "File not found on server": "apiErrors.fileNotFoundOnServer",
  "Missing authorization": "apiErrors.unauthorized",
  "Invalid password": "apiErrors.invalidPassword",
  "Invalid authorization header format": "apiErrors.unauthorized",
  "Missing authorization header": "apiErrors.unauthorized",
  "Vector search requires an embedding model": "apiErrors.embeddingModelRequired",
  "Ask feature requires an embedding model": "apiErrors.embeddingModelRequired",
  "Strategy model": "apiErrors.strategyModelNotFound",
  "Answer model": "apiErrors.answerModelNotFound",
  "Final answer model": "apiErrors.finalAnswerModelNotFound",
  "No answer generated": "apiErrors.noAnswerGenerated",
  "Administrator access is required for this action": "apiErrors.adminRequired",
  "Only an administrator can edit shared transformations": "apiErrors.transformationEditShared",
  "You can only edit your own transformations": "apiErrors.transformationEditOwn",
  "Only an administrator can delete shared transformations": "apiErrors.transformationDeleteShared",
  "You can only delete your own transformations": "apiErrors.transformationDeleteOwn",
  "Only an administrator can restore built-in transformations": "apiErrors.transformationRestoreAdmin",
  "Only an administrator can edit the default transformation prompt": "apiErrors.transformationDefaultPromptAdmin",
  "CSRF origin check failed": "apiErrors.csrfFailed",
  "Not authenticated": "apiErrors.unauthorized",
};

function mappedKey(message: string): string | undefined {
  if (ERROR_MAP[message]) return ERROR_MAP[message]
  for (const [key, value] of Object.entries(ERROR_MAP)) {
    if (message.startsWith(key)) return value
  }
  return undefined
}

/**
 * Translates a backend error message using the ERROR_MAP.
 * If no mapping exists, returns the fallback key or generic error key.
 */
export function getApiErrorKey(errorOrMessage: unknown, fallbackKey?: string): string {
  const message = formatApiError(errorOrMessage)

  if (!message) {
    if (responseStatus(errorOrMessage) === 403) return fallbackKey || "apiErrors.forbidden"
    return fallbackKey || "apiErrors.genericError"
  }

  const key = mappedKey(message)
  if (key) return key

  if (responseStatus(errorOrMessage) === 403) {
    return fallbackKey || "apiErrors.forbidden"
  }

  return fallbackKey || "apiErrors.genericError"
}

/**
 * Extracts the error message, looks up i18n mapping, and falls back to the
 * backend-provided message when no mapping exists. This ensures user-friendly
 * error messages from the backend are displayed directly in the UI.
 */
export function getApiErrorMessage(
  errorOrMessage: unknown,
  t: (key: string) => string,
  fallbackKey?: string
): string {
  const message = formatApiError(errorOrMessage)
  const status = responseStatus(errorOrMessage)
  const fallback = () => fallbackKey ? t(fallbackKey) : t("apiErrors.genericError")
  if (!message) {
    if (status === 403) {
      return t(fallbackKey || "apiErrors.forbidden")
    }
    return fallback()
  }

  const key = mappedKey(message)
  if (key) return t(key)

  if (status === 403) {
    return t(fallbackKey || "apiErrors.forbidden")
  }

  // Unmapped 4xx details are actionable validation feedback. Client/network
  // exceptions and 5xx details can contain paths or stack fragments.
  return status !== undefined && status >= 400 && status < 500
    ? message
    : fallback()
}

/**
 * Formats a raw error from the API into a user-friendly (potentially translated) string.
 */
export function formatApiError(error: unknown): string {
  if (typeof error === 'string') return error

  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (typeof error.message === 'string' && error.message) return error.message
  }

  const err = error as { response?: { data?: { detail?: string } }, detail?: string, message?: string }
  const detail = err?.response?.data?.detail || err?.detail || err?.message

  if (typeof detail === 'string') {
    return detail
  }

  return ""
}
