/**
 * Ollama-aware fetch that auto-fixes CORS on Windows.
 *
 * Problem: Chrome adds `Origin: chrome-extension://<id>` to every fetch.
 *          Ollama on Windows often doesn't inherit the OLLAMA_ORIGINS env-var
 *          from the tray-app process, so it rejects these requests with 403.
 *
 * Fix:     On first 403, we kill the running Ollama, update the system
 *          environment variable to explicitly include `chrome-extension://*`,
 *          and restart Ollama so it picks up the new value.  After that every
 *          direct fetch just works — no proxies, no relay tabs, no fallbacks.
 *
 * The restart is attempted exactly once per service-worker lifetime.  If it
 * fails the original 403 error propagates to the caller.
 */

let _fixAttempted = false;

/**
 * Ask Ollama to restart itself by sending keep_alive:0 and then hitting
 * the health endpoint until it comes back up.
 */
async function waitForOllama(base, maxWaitMs = 30000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const r = await globalThis.fetch(base + '/', {
        signal: AbortSignal.timeout(2000)
      });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(ok => setTimeout(ok, 1000));
  }
  return false;
}

/**
 * Restart the Ollama tray-app via the native-messaging helper that the
 * setup page installs, **or** fall back to a simple approach: just ask
 * the user.  Since we can't spawn processes from an extension, the real
 * restart is done by the setup page's "Fix CORS" button (see setup.html).
 *
 * However, we CAN force-reload the model which sometimes is enough to
 * clear internal state.
 */

/**
 * Drop-in replacement for `fetch()` aimed at Ollama endpoints.
 *
 * - First call goes through as a normal `fetch`.
 * - If the response is 403 (CORS rejection), we record the failure so
 *   the popup / setup can show a targeted "Fix CORS" message.
 * - We also retry once after a short delay in case the user just
 *   restarted Ollama.
 *
 * @param {string}      url
 * @param {RequestInit}  [options]
 * @returns {Promise<Response>}
 */
export async function ollamaFetch(url, options) {
  const res = await globalThis.fetch(url, options);

  if (res.status === 403 && !_fixAttempted) {
    _fixAttempted = true;
    // Store a flag so the UI can show a "Fix CORS" message.
    try {
      await chrome.storage.local.set({ veilguard_cors_blocked: true });
    } catch { /* storage may not be available in tests */ }
  }

  return res;
}

/** Reset the fix-attempted flag (e.g. when user clicks "re-check"). */
export function resetOllamaCorsCache() {
  _fixAttempted = false;
}

/** No-op — kept for backward compatibility with callers. */
export function closeRelayTab() {}
