const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])
const MAX_ATTEMPTS = 4
const BASE_DELAY_MS = 500

function retryDelayMs(attempt: number): number {
  const exponential = BASE_DELAY_MS * 2 ** attempt
  const jitter = Math.random() * BASE_DELAY_MS
  return exponential + jitter
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retries transient server/rate-limit failures with exponential backoff.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let lastResponse: Response | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(input, init)
    if (response.ok || !RETRYABLE_STATUSES.has(response.status)) {
      return response
    }

    lastResponse = response
    if (attempt === MAX_ATTEMPTS - 1) break
    await sleep(retryDelayMs(attempt))
  }

  return lastResponse!
}
