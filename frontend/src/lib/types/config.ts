/**
 * Backend configuration response from Python API /api/config endpoint.
 * Note: apiUrl is determined by the Next.js runtime-config endpoint,
 * not returned by the Python backend.
 */
export interface BackendConfigResponse {
  version: string
  latestVersion?: string | null
  hasUpdate?: boolean
  dbStatus?: "online" | "offline"
}

/**
 * Complete application configuration used by the frontend.
 * This is constructed from the backend response + runtime-config.
 */
export interface AppConfig {
  apiUrl: string
  version: string
  buildTime: string
  latestVersion?: string | null
  hasUpdate?: boolean
  dbStatus?: "online" | "offline"
}

/**
 * Connection error state.
 *
 * Deliberately carries no diagnostic payload (no attempted URL, technical
 * message, or stack trace) — the overlay renders fixed, translated copy
 * keyed only on `type`, so nothing environment-specific ever reaches the
 * user-facing gateway.
 */
export interface ConnectionError {
  type: "api-unreachable" | "database-offline"
}
