/**
 * Ollama-aware fetch wrapper.
 *
 * CORS handling: Chrome's declarativeNetRequest rules (rules/ollama-headers.json)
 * automatically set the Origin header to "http://localhost" on all requests to
 * Ollama (127.0.0.1:11434 / localhost:11434).  Ollama accepts localhost as a
 * default allowed origin, so no manual CORS setup or relay is needed.
 *
 * This module provides a thin wrapper that detects any remaining 403 responses
 * and records them for UI diagnostics (e.g. if the user has a non-standard
 * Ollama setup that the declarativeNetRequest rules don't cover).
 */

let _corsNotified = false;

/**
 * Drop-in replacement for `fetch()` aimed at Ollama endpoints.
 *
 * @param {string}      url
 * @param {RequestInit}  [options]
 * @returns {Promise<Response>}
 */
export async function ollamaFetch(url, options) {
  const res = await globalThis.fetch(url, options);

  if (res.status === 403 && !_corsNotified) {
    _corsNotified = true;
    try {
      await chrome.storage.local.set({ veilguard_cors_blocked: true });
    } catch { /* storage may not be available in tests */ }
  }

  return res;
}

/** Reset the notification flag (e.g. when user clicks "re-check"). */
export function resetOllamaCorsCache() {
  _corsNotified = false;
  try {
    chrome.storage.local.remove('veilguard_cors_blocked').catch(() => { });
  } catch { /* ignore */ }
}

/** No-op — kept for backward compatibility with callers. */
export function closeRelayTab() { }
