(() => {
  if (window.__VEILGUARD_BRIDGE_INSTALLED__) return;
  window.__VEILGUARD_BRIDGE_INSTALLED__ = true;

  const BRIDGE_SOURCE = 'VEILGUARD_BRIDGE';
  const CONTENT_SOURCE = 'VEILGUARD_CONTENT';
  const TRANSFORM_TIMEOUT_MS = 12000;

  const CHAT_URL_PATTERNS = [
    /\/(chat|conversation|completion|prompt)(\/|$|\?)/i,
    /\/api\/(chat|generate|message)/i,
    /\/v\d+\/(chat|completions|messages)/i,
    /anthropic\.com/i,
    /claude\.ai/i,
    /\/ces\/v1\//i,
    /\/api\/organizations\//i,
    /BotChatLayerService/i
  ];

  function looksLikeJson(text) {
    if (!text || text.length < 2) return false;
    const first = text.trimStart()[0];
    return first === '{' || first === '[';
  }

  function shouldIntercept(url, bodyText) {
    if (!looksLikeJson(bodyText)) return false;
    if (CHAT_URL_PATTERNS.some((r) => r.test(url))) return true;
    if (bodyText.length < 500_000 && /"(?:messages|prompt|contents|content_type)"\s*:/.test(bodyText)) return true;
    return false;
  }

  let sequence = 0;
  const pending = new Map();

  function bodyToString(body) {
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    return null;
  }

  function headersToObject(headersLike) {
    const output = {};
    if (!headersLike) return output;

    const headers = new Headers(headersLike);
    for (const [key, value] of headers.entries()) {
      output[key] = value;
    }
    return output;
  }

  async function readRequestBody(input, init) {
    const initBody = bodyToString(init?.body);
    if (initBody != null) return initBody;

    if (input instanceof Request) {
      try {
        const clone = input.clone();
        const text = await clone.text();
        return text || null;
      } catch {
        return null;
      }
    }

    return null;
  }

  function requestTransform(payload) {
    return new Promise((resolve) => {
      const requestId = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        resolve({ action: 'allow', changed: false, bodyText: payload.bodyText });
      }, TRANSFORM_TIMEOUT_MS);

      pending.set(requestId, { resolve, timeout });

      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          type: 'REQUEST_TRANSFORM_OUTGOING',
          requestId,
          payload
        },
        '*'
      );
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CONTENT_SOURCE || data.type !== 'RESPONSE_TRANSFORM_OUTGOING') return;

    const inFlight = pending.get(data.requestId);
    if (!inFlight) return;

    clearTimeout(inFlight.timeout);
    pending.delete(data.requestId);
    inFlight.resolve(data.result || { action: 'allow', changed: false });
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init = undefined) {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      return originalFetch(input, init);
    }

    const bodyText = await readRequestBody(input, init);
    if (!bodyText) {
      return originalFetch(input, init);
    }

    const url = input instanceof Request ? input.url : String(input);

    if (!shouldIntercept(url, bodyText)) {
      return originalFetch(input, init);
    }

    const headers = headersToObject(init?.headers || (input instanceof Request ? input.headers : undefined));

    const result = await requestTransform({
      transport: 'fetch',
      url,
      method,
      headers,
      bodyText,
      origin: window.location.origin
    });

    if (result.action === 'block') {
      return Promise.reject(new Error('VeilGuard blocked outgoing request'));
    }

    if (!result.changed) {
      return originalFetch(input, init);
    }

    const nextInit = {
      ...(init || {}),
      method,
      headers: new Headers(headers),
      body: result.bodyText
    };

    return originalFetch(input instanceof Request ? input.url : input, nextInit);
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const xhrMeta = new WeakMap();

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...args) {
    xhrMeta.set(this, {
      method: String(method || 'GET').toUpperCase(),
      url: String(url || ''),
      headers: {}
    });
    return originalXHROpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(key, value) {
    const meta = xhrMeta.get(this);
    if (meta) {
      meta.headers[String(key).toLowerCase()] = String(value);
    }
    return originalXHRSetHeader.call(this, key, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const meta = xhrMeta.get(this);
    if (!meta || !['POST', 'PUT', 'PATCH'].includes(meta.method) || typeof body !== 'string') {
      return originalXHRSend.call(this, body);
    }

    if (!shouldIntercept(meta.url, body)) {
      return originalXHRSend.call(this, body);
    }

    requestTransform({
      transport: 'xhr',
      url: meta.url,
      method: meta.method,
      headers: meta.headers,
      bodyText: body,
      origin: window.location.origin
    })
      .then((result) => {
        if (result.action === 'block') {
          this.dispatchEvent(new Event('error'));
          this.abort();
          return;
        }
        originalXHRSend.call(this, result.changed ? result.bodyText : body);
      })
      .catch(() => {
        originalXHRSend.call(this, body);
      });
  };

  const originalWSSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function patchedWSSend(data) {
    if (typeof data !== 'string') {
      return originalWSSend.call(this, data);
    }

    if (!shouldIntercept(this.url, data)) {
      return originalWSSend.call(this, data);
    }

    requestTransform({
      transport: 'websocket',
      url: this.url,
      method: 'WS_SEND',
      headers: {},
      bodyText: data,
      origin: window.location.origin
    })
      .then((result) => {
        if (result.action === 'block') return;
        originalWSSend.call(this, result.changed ? result.bodyText : data);
      })
      .catch(() => {
        originalWSSend.call(this, data);
      });
  };
})();
