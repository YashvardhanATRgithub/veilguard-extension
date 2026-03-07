(() => {
  const BRIDGE_SOURCE = 'VEILGUARD_BRIDGE';
  const CONTENT_SOURCE = 'VEILGUARD_CONTENT';

  const CHAT_SELECTORS = [
    'div[data-message-author-role="assistant"]',
    'div[data-message-author-role="user"]',
    '[data-testid*="assistant"]',
    '[data-message-role="assistant"]',
    '[data-message-role="user"]',
    '[data-is-streaming="true"]',
    '[data-is-streaming="false"]',
    'message-content',
    '[class*="assistant"]',
    '[class*="user-message"]',
    '[class*="UserMessage"]',
    '.font-user-message',
    '.font-claude-message',
    '[data-test-render-count]'
  ].join(',');

  const EDITABLE_SELECTORS = [
    'textarea',
    'input',
    '[contenteditable="true"]',
    '#prompt-textarea',
    '.ProseMirror',
    '.ql-editor'
  ].join(',');

  let activeSessionKey = null;
  let fakeToRealMap = {};
  let observer = null;
  let refreshTimer = null;

  const PRIVACY_INSTRUCTION =
    '[Privacy note: Some values in this message have been replaced with privacy ' +
    'placeholders (e.g., PERSON_1, EMAIL_1) by a browser extension. Treat these ' +
    'placeholders as real values and respond naturally \u2014 do not mention or ' +
    'question the placeholders.]\n\n';

  let isApplying = false;
  let flushScheduled = false;
  const pendingContainers = new Set();

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'empty_response' });
        });
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  function injectBridge() {
    const existing = document.querySelector('script[data-veilguard-bridge="1"]');
    if (existing) return;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page/bridge.js');
    script.async = false;
    script.dataset.veilguardBridge = '1';
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function rehydrateString(text, map) {
    const keys = Object.keys(map || {}).sort((a, b) => b.length - a.length);
    if (keys.length === 0) return text;

    let output = text;
    for (const fake of keys) {
      const real = map[fake];
      if (!real) continue;

      const escaped = escapeRegExp(fake);
      const startsWord = /[A-Za-z0-9]/.test(fake[0] || '');
      const endsWord = /[A-Za-z0-9]/.test(fake[fake.length - 1] || '');
      const pattern = startsWord && endsWord
        ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g')
        : new RegExp(escaped, 'g');

      output = output.replace(pattern, real);
    }
    return output;
  }

  function isEditableElement(element) {
    if (!element) return false;
    return !!element.closest(EDITABLE_SELECTORS);
  }

  function getElementFromNode(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) return node;
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
    return null;
  }

  function findChatContainer(node) {
    const element = getElementFromNode(node);
    if (!element) return null;
    if (isEditableElement(element)) return null;
    return element.closest(CHAT_SELECTORS);
  }

  function collectTextNodes(container) {
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    let current = walker.nextNode();
    while (current) {
      const parent = current.parentElement;
      if (parent) {
        const tag = parent.tagName.toLowerCase();
        const skipTag = tag === 'script' || tag === 'style' || tag === 'textarea';
        const skipEditable = isEditableElement(parent);
        if (!skipTag && !skipEditable) {
          nodes.push(current);
        }
      }
      current = walker.nextNode();
    }

    return nodes;
  }

  function applyRehydrationToContainer(container) {
    if (!container || !container.isConnected) return;
    const nodes = collectTextNodes(container);
    if (nodes.length === 0) return;

    const segments = nodes.map((node) => node.textContent || '');
    let combined = segments.join('');
    if (!combined.trim()) return;

    // Strip the privacy instruction so users never see it.
    let instructionStripped = false;
    if (combined.includes(PRIVACY_INSTRUCTION)) {
      combined = combined.split(PRIVACY_INSTRUCTION).join('');
      instructionStripped = true;
    }

    const keys = Object.keys(fakeToRealMap || {}).sort((a, b) => b.length - a.length);
    if (keys.length === 0 && !instructionStripped) return;

    const replacements = [];
    for (const fake of keys) {
      const real = fakeToRealMap[fake];
      if (!real) continue;

      const escaped = escapeRegExp(fake);
      const startsWord = /[A-Za-z0-9]/.test(fake[0] || '');
      const endsWord = /[A-Za-z0-9]/.test(fake[fake.length - 1] || '');
      const pattern = startsWord && endsWord
        ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g')
        : new RegExp(escaped, 'g');

      let match;
      while ((match = pattern.exec(combined)) !== null) {
        replacements.push({
          start: match.index,
          end: match.index + fake.length,
          real
        });
      }
    }

    if (replacements.length === 0) return;
    replacements.sort((a, b) => a.start - b.start);

    // Filter overlapping
    const merged = [];
    for (const r of replacements) {
      if (merged.length === 0) {
        merged.push(r);
      } else {
        const last = merged[merged.length - 1];
        if (r.start >= last.end) {
          merged.push(r);
        }
      }
    }

    isApplying = true;
    try {
      let combinedCursor = 0;
      let rIdx = 0;

      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const seg = segments[i];
        const nodeStart = combinedCursor;
        const nodeEnd = combinedCursor + seg.length;
        combinedCursor = nodeEnd;

        let newText = '';
        let nodeCursor = nodeStart;

        while (nodeCursor < nodeEnd) {
          const r = merged[rIdx];
          if (!r || r.start >= nodeEnd) {
            newText += combined.substring(nodeCursor, nodeEnd);
            nodeCursor = nodeEnd;
          } else if (r.end <= nodeCursor) {
            rIdx += 1;
          } else {
            if (nodeCursor < r.start) {
              newText += combined.substring(nodeCursor, r.start);
              nodeCursor = r.start;
            }

            // At replacement start
            if (nodeCursor === r.start) {
              newText += r.real;
            }

            const jump = Math.min(nodeEnd, r.end);
            nodeCursor = jump;

            if (nodeCursor >= r.end) {
              rIdx += 1;
            }
          }
        }

        if (node.textContent !== newText) {
          node.textContent = newText;
        }
      }
    } finally {
      isApplying = false;
    }
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;

    const run = () => {
      flushScheduled = false;
      const targets = [...pendingContainers];
      pendingContainers.clear();
      for (const container of targets) {
        applyRehydrationToContainer(container);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  }

  function enqueueContainer(container) {
    if (!container || !container.isConnected) return;
    pendingContainers.add(container);
    scheduleFlush();
  }

  function enqueueAllChatContainers() {
    const containers = document.querySelectorAll(CHAT_SELECTORS);
    for (const container of containers) {
      enqueueContainer(container);
    }
  }

  function startObserver() {
    const start = () => {
      if (observer) observer.disconnect();
      observer = new MutationObserver((mutations) => {
        if (isApplying) return;

        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            const container = findChatContainer(mutation.target);
            if (container) enqueueContainer(container);
            continue;
          }

          for (const added of mutation.addedNodes) {
            const container = findChatContainer(added);
            if (container) enqueueContainer(container);

            if (added.nodeType === Node.ELEMENT_NODE) {
              const nested = added.querySelectorAll?.(CHAT_SELECTORS);
              if (nested && nested.length) {
                for (const entry of nested) enqueueContainer(entry);
              }
            }
          }
        }
      });

      observer.observe(document.documentElement || document.body, {
        subtree: true,
        childList: true,
        characterData: true
      });

      enqueueAllChatContainers();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  async function refreshMap() {
    const response = await sendRuntimeMessage({
      type: 'VG_GET_REHYDRATION_MAP',
      sessionKey: activeSessionKey,
      origin: window.location.origin
    });

    if (response?.ok && response.map) {
      fakeToRealMap = response.map;
      enqueueAllChatContainers();
    }
  }

  // ── Ollama fetch relay (CORS bypass for Windows) ─────────────────────
  // The service worker's fetch() carries Origin: chrome-extension://…
  // which some Ollama builds reject with 403.  When that happens the
  // service worker asks us to make the call instead — our fetch() uses
  // the web-page origin, which Ollama accepts.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'VG_OLLAMA_FETCH') return false;

    const { url, fetchOptions } = message;
    fetch(url, {
      method:  fetchOptions?.method  || 'GET',
      headers: fetchOptions?.headers || {},
      body:    fetchOptions?.body    || null,
      signal:  AbortSignal.timeout(60000)
    })
      .then(async (res) => {
        let data = null;
        try { data = await res.json(); } catch { /* non-JSON response */ }
        sendResponse({ status: res.status, data });
      })
      .catch((err) => {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      });

    return true; // keep channel open for async sendResponse
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE || data.type !== 'REQUEST_TRANSFORM_OUTGOING') return;

    const response = await sendRuntimeMessage({
      type: 'VG_TRANSFORM_OUTGOING',
      payload: data.payload
    });

    const result = response?.ok
      ? {
        action: response.action,
        changed: response.changed,
        bodyText: response.bodyText,
        replacements: response.replacements,
        adapterId: response.adapterId
      }
      : { action: 'allow', changed: false, bodyText: data.payload?.bodyText || '' };

    if (response?.ok && response.sessionKey) {
      activeSessionKey = response.sessionKey;
    }

    if (response?.ok && response.fakeToRealMap) {
      fakeToRealMap = response.fakeToRealMap;
      enqueueAllChatContainers();
    }

    window.postMessage(
      {
        source: CONTENT_SOURCE,
        type: 'RESPONSE_TRANSFORM_OUTGOING',
        requestId: data.requestId,
        result
      },
      '*'
    );
  });

  injectBridge();
  startObserver();
  refreshMap();
  refreshTimer = setInterval(refreshMap, 2000);

  window.addEventListener('beforeunload', () => {
    if (observer) observer.disconnect();
    if (refreshTimer) clearInterval(refreshTimer);
  });
})();
