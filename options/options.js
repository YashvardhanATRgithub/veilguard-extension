const ttlEl = document.getElementById('ttlMs');
const maxPayloadCharsEl = document.getElementById('maxPayloadChars');
const maxSessionBytesApproxEl = document.getElementById('maxSessionBytesApprox');
const maxSessionsEl = document.getElementById('maxSessions');
const maxMappingsEl = document.getElementById('maxMappingsPerSession');
const debugEl = document.getElementById('debug');
const localLlmEndpointEl = document.getElementById('localLlmEndpoint');
const localLlmModelEl = document.getElementById('localLlmModel');
const localLlmTimeoutMsEl = document.getElementById('localLlmTimeoutMs');
const failPolicyEl = document.getElementById('failPolicy');
const saveBtn = document.getElementById('save');
const resetBtn = document.getElementById('resetDefaults');
const statusEl = document.getElementById('status');
const eventsEl = document.getElementById('events');
const refreshEventsBtn = document.getElementById('refreshEvents');
const clearEventsBtn = document.getElementById('clearEvents');
const metricsEl = document.getElementById('metrics');
const refreshMetricsBtn = document.getElementById('refreshMetrics');
const resetMetricsBtn = document.getElementById('resetMetrics');
const connectionPill = document.getElementById('connectionPill');
const connectionLabel = document.getElementById('connectionLabel');

let eventsPollTimer = null;
let metricsPollTimer = null;

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false });
    });
  });
}

function setStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => {
    if (statusEl.textContent === text) statusEl.textContent = '';
  }, 2000);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

async function checkConnection() {
  try {
    const res = await send({ type: 'VG_CHECK_OLLAMA' });
    if (res?.online) {
      connectionPill.className = 'connection-pill online';
      connectionLabel.textContent = 'Ollama Online';
    } else {
      connectionPill.className = 'connection-pill offline';
      connectionLabel.textContent = 'Ollama Offline';
    }
  } catch {
    connectionPill.className = 'connection-pill offline';
    connectionLabel.textContent = 'Ollama Offline';
  }
}

async function loadModels(selectedModel) {
  const res = await send({ type: 'VG_LIST_MODELS' });
  localLlmModelEl.innerHTML = '';

  if (!res?.ok || !Array.isArray(res.models) || res.models.length === 0) {
    const opt = document.createElement('option');
    opt.value = selectedModel || 'qwen2.5:1.5b';
    opt.textContent = selectedModel || 'qwen2.5:1.5b';
    opt.selected = true;
    localLlmModelEl.appendChild(opt);
    return;
  }

  let found = false;
  for (const m of res.models) {
    const opt = document.createElement('option');
    opt.value = m.name;
    const sizeMB = m.size ? (m.size / 1e6).toFixed(0) + 'MB' : '';
    opt.textContent = sizeMB ? `${m.name} (${sizeMB})` : m.name;
    if (m.name === selectedModel) { opt.selected = true; found = true; }
    localLlmModelEl.appendChild(opt);
  }

  if (!found && selectedModel) {
    const opt = document.createElement('option');
    opt.value = selectedModel;
    opt.textContent = selectedModel + ' (not installed)';
    opt.selected = true;
    localLlmModelEl.prepend(opt);
  }
}

function populateFields(s) {
  ttlEl.value = s.ttlMs;
  maxPayloadCharsEl.value = s.maxPayloadChars;
  maxSessionBytesApproxEl.value = s.maxSessionBytesApprox;
  maxSessionsEl.value = s.maxSessions;
  maxMappingsEl.value = s.maxMappingsPerSession;
  debugEl.checked = !!s.debug;
  localLlmEndpointEl.value = s.localLlmEndpoint || 'http://127.0.0.1:11434/api/chat';
  localLlmTimeoutMsEl.value = Number.isFinite(s.localLlmTimeoutMs) ? String(s.localLlmTimeoutMs) : '15000';
  failPolicyEl.value = s.failPolicy || 'block';
}

function renderEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    eventsEl.innerHTML = '<div class="empty-state">No events recorded yet. Use a chat app with VeilGuard enabled to see activity.</div>';
    return;
  }

  const rows = events.slice(0, 120).map((event) => {
    const ts = event.ts || '';
    const kind = event.kind || 'event';
    const adapter = event.adapterId || '—';
    const method = event.method || '';
    const action = event.action || '';
    const changed = event.changed ? '✓ changed' : 'unchanged';
    const repl = Number.isFinite(event.replacements) ? event.replacements : 0;
    const url = event.url || '';
    const error = event.error ? ` | ⚠ ${event.error}` : '';

    return `
      <div class="event-row">
        <div class="event-meta">
          <span>${ts}</span>
          <span>${kind}</span>
          <span>${adapter}</span>
          <span>${method}</span>
          <span>${action}</span>
          <span>${changed}</span>
          <span>repl=${repl}</span>
        </div>
        <div class="event-detail">${url}${error}</div>
      </div>
    `;
  });

  eventsEl.innerHTML = rows.join('');
}

async function refreshEvents() {
  const response = await send({ type: 'VG_GET_DEBUG_EVENTS' });
  if (!response?.ok) return;
  renderEvents(response.events || []);
}

function renderMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    metricsEl.innerHTML = '<div class="empty-state">No metrics available yet.</div>';
    return;
  }

  const totals = metrics.totals || {};
  const latency = metrics.latency || {};
  const byAdapter = metrics.byAdapter || {};
  const adapterRows = Object.entries(byAdapter)
    .sort((a, b) => (b[1]?.requests || 0) - (a[1]?.requests || 0))
    .slice(0, 10)
    .map(([adapterId, bucket]) => `
      <tr>
        <td>${adapterId}</td>
        <td>${formatNumber(bucket.requests)}</td>
        <td>${formatNumber(bucket.changed)}</td>
        <td>${formatNumber(bucket.replacements)}</td>
        <td>${formatNumber(bucket.errors)}</td>
      </tr>
    `)
    .join('');

  metricsEl.innerHTML = `
    <div class="metric-grid">
      <div class="metric-card"><span class="metric-key">Requests</span><span class="metric-value">${formatNumber(totals.requests)}</span></div>
      <div class="metric-card"><span class="metric-key">Changed</span><span class="metric-value">${formatNumber(totals.changed)}</span></div>
      <div class="metric-card"><span class="metric-key">Replacements</span><span class="metric-value">${formatNumber(totals.replacements)}</span></div>
      <div class="metric-card"><span class="metric-key">Blocked</span><span class="metric-value">${formatNumber(totals.blocked)}</span></div>
      <div class="metric-card"><span class="metric-key">Errors</span><span class="metric-value">${formatNumber(totals.errors)}</span></div>
      <div class="metric-card"><span class="metric-key">Avg Latency</span><span class="metric-value">${formatNumber(latency.avg, 0)}ms</span></div>
      <div class="metric-card"><span class="metric-key">P95 Latency</span><span class="metric-value">${formatNumber(latency.p95, 0)}ms</span></div>
      <div class="metric-card"><span class="metric-key">Last Updated</span><span class="metric-value" style="font-size:11px">${metrics.updatedAt || '—'}</span></div>
    </div>
    <table class="metric-table">
      <thead>
        <tr><th>Adapter</th><th>Requests</th><th>Changed</th><th>Replacements</th><th>Errors</th></tr>
      </thead>
      <tbody>${adapterRows || '<tr><td colspan="5" class="empty-state">No adapter activity yet.</td></tr>'}</tbody>
    </table>
  `;
}

async function refreshMetrics() {
  const response = await send({ type: 'VG_GET_METRICS' });
  if (!response?.ok) return;
  renderMetrics(response.metrics);
}

async function load() {
  const response = await send({ type: 'VG_GET_SETTINGS' });
  if (!response?.ok) return;
  const s = response.settings;
  populateFields(s);
  await loadModels(s.localLlmModel || 'qwen2.5:1.5b');
}

saveBtn.addEventListener('click', async () => {
  const patch = {
    ttlMs: Number(ttlEl.value),
    maxPayloadChars: Number(maxPayloadCharsEl.value),
    maxSessionBytesApprox: Number(maxSessionBytesApproxEl.value),
    maxSessions: Number(maxSessionsEl.value),
    maxMappingsPerSession: Number(maxMappingsEl.value),
    debug: !!debugEl.checked,
    localLlmEndpoint: String(localLlmEndpointEl.value || '').trim(),
    localLlmModel: localLlmModelEl.value || 'qwen2.5:1.5b',
    localLlmTimeoutMs: Number(localLlmTimeoutMsEl.value),
    failPolicy: failPolicyEl.value
  };

  const response = await send({ type: 'VG_SET_SETTINGS_PATCH', patch });
  if (response?.ok) {
    const n = response.settings || {};
    populateFields(n);
    setStatus('✓ Saved');
    checkConnection();
  } else {
    setStatus('❌ Save failed');
  }
});

resetBtn.addEventListener('click', async () => {
  const res = await send({ type: 'VG_GET_DEFAULTS' });
  if (!res?.ok || !res.defaults) { setStatus('❌ Failed'); return; }
  const d = res.defaults;
  populateFields(d);
  await loadModels(d.localLlmModel || 'qwen2.5:1.5b');
  setStatus('↺ Defaults restored — click Save to apply');
});

refreshEventsBtn.addEventListener('click', refreshEvents);
refreshMetricsBtn.addEventListener('click', refreshMetrics);

clearEventsBtn.addEventListener('click', async () => {
  const response = await send({ type: 'VG_CLEAR_DEBUG_EVENTS' });
  if (response?.ok) { renderEvents([]); setStatus('Events cleared'); }
});

resetMetricsBtn.addEventListener('click', async () => {
  const response = await send({ type: 'VG_RESET_METRICS' });
  if (response?.ok) { renderMetrics(response.metrics); setStatus('Metrics reset'); }
});

// Boot
load();
checkConnection();
refreshEvents();
refreshMetrics();
eventsPollTimer = setInterval(refreshEvents, 3000);
metricsPollTimer = setInterval(refreshMetrics, 5000);
setInterval(checkConnection, 10000);

window.addEventListener('beforeunload', () => {
  if (eventsPollTimer) clearInterval(eventsPollTimer);
  if (metricsPollTimer) clearInterval(metricsPollTimer);
});
