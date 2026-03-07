const enabledEl = document.getElementById('enabled');
const statusEl = document.getElementById('status');
const shieldIcon = document.getElementById('shieldIcon');
const toggleCard = document.getElementById('toggleCard');
const toggleStatus = document.getElementById('toggleStatus');
const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const statRedacted = document.getElementById('statRedacted');
const statRequests = document.getElementById('statRequests');
const statBlocked = document.getElementById('statBlocked');
const displayPolicy = document.getElementById('displayPolicy');
const modelSelect = document.getElementById('modelSelect');
const progressSection = document.getElementById('progressSection');
const setupGuide = document.getElementById('setupGuide');
const statsSection = document.getElementById('statsSection');

const stepOllama = document.getElementById('stepOllama');
const stepOllamaIcon = document.getElementById('stepOllamaIcon');
const stepModel = document.getElementById('stepModel');
const stepModelIcon = document.getElementById('stepModelIcon');
const stepReady = document.getElementById('stepReady');
const stepReadyIcon = document.getElementById('stepReadyIcon');

let ollamaOnline = false;

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false });
    });
  });
}

function formatNumber(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function showToast(text) {
  statusEl.textContent = text;
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), 1500);
}

function setStep(stepEl, iconEl, state) {
  stepEl.classList.remove('active', 'done', 'error', 'warn');
  if (state === 'active') { stepEl.classList.add('active'); iconEl.textContent = '⏳'; }
  else if (state === 'done') { stepEl.classList.add('done'); iconEl.textContent = '✅'; }
  else if (state === 'warn') { stepEl.classList.add('done'); iconEl.textContent = '⚠️'; }
  else if (state === 'error') { stepEl.classList.add('error'); iconEl.textContent = '❌'; }
  else { iconEl.textContent = '⏳'; }
}

function updateVisualState(isEnabled) {
  shieldIcon.className = isEnabled ? 'shield-icon active' : 'shield-icon inactive';
  toggleCard.className = isEnabled ? 'toggle-card active' : 'toggle-card';
  toggleStatus.textContent = isEnabled ? 'Active' : 'Disabled';
  toggleStatus.className = isEnabled ? 'toggle-status' : 'toggle-status off';

  if (isEnabled) {
    statsSection.classList.remove('hidden');
    setupGuide.classList.add('hidden');
  } else {
    statsSection.classList.add('hidden');
    if (!ollamaOnline) setupGuide.classList.remove('hidden');
  }
}

async function checkOllama() {
  const res = await send({ type: 'VG_CHECK_OLLAMA' });
  ollamaOnline = !!(res?.online);

  if (ollamaOnline) {
    connectionBadge.className = 'connection-badge online';
    connectionText.textContent = 'Ollama Online';
    setupGuide.classList.add('hidden');
  } else {
    connectionBadge.className = 'connection-badge offline';
    connectionText.textContent = 'Ollama Offline';
    if (!enabledEl.checked) setupGuide.classList.remove('hidden');
  }

  return ollamaOnline;
}

async function loadModels() {
  const res = await send({ type: 'VG_LIST_MODELS' });
  if (!res?.ok || !Array.isArray(res.models) || res.models.length === 0) {
    modelSelect.innerHTML = '<option value="">No models found</option>';
    return [];
  }

  const settings = (await send({ type: 'VG_GET_SETTINGS' }))?.settings || {};
  const currentModel = settings.localLlmModel || 'qwen2.5:1.5b';

  modelSelect.innerHTML = '';
  for (const m of res.models) {
    const opt = document.createElement('option');
    opt.value = m.name;
    const sizeMB = m.size ? (m.size / 1e6).toFixed(0) + 'MB' : '';
    opt.textContent = sizeMB ? `${m.name} (${sizeMB})` : m.name;
    if (m.name === currentModel) opt.selected = true;
    modelSelect.appendChild(opt);
  }

  return res.models;
}

async function enableSequence() {
  progressSection.classList.remove('hidden');
  setupGuide.classList.add('hidden');
  enabledEl.disabled = true;

  // Step 1: Check Ollama
  setStep(stepOllama, stepOllamaIcon, 'active');
  setStep(stepModel, stepModelIcon, null);
  setStep(stepReady, stepReadyIcon, null);

  const online = await checkOllama();
  if (!online) {
    setStep(stepOllama, stepOllamaIcon, 'error');
    enabledEl.checked = false;
    enabledEl.disabled = false;
    updateVisualState(false);
    setupGuide.classList.remove('hidden');
    showToast('❌ Ollama not running');
    setTimeout(() => progressSection.classList.add('hidden'), 2000);
    return;
  }
  setStep(stepOllama, stepOllamaIcon, 'done');

  // Step 2: Check model exists & CORS
  setStep(stepModel, stepModelIcon, 'active');
  const selectedModel = modelSelect.value || 'qwen2.5:1.5b';
  const loadRes = await send({ type: 'VG_LOAD_MODEL', model: selectedModel });

  // Did we get a CORS 403 block from Ollama? 
  // (ollamaFetch sets this flag if it gets a 403)
  const { veilguard_cors_blocked } = await chrome.storage.local.get('veilguard_cors_blocked');

  if (veilguard_cors_blocked) {
    setStep(stepModel, stepModelIcon, 'error');
    enabledEl.checked = false;
    enabledEl.disabled = false;
    updateVisualState(false);
    setupGuide.classList.remove('hidden');
    // Open setup page directly to the Windows tab 
    setupGuide.querySelector('.banner-text').innerHTML = `
      <span class="banner-title" style="color:var(--error)">Extension Blocked (CORS)</span>
      <span class="banner-sub">Run the Windows Fix command in the setup guide.</span>
    `;
    setTimeout(() => progressSection.classList.add('hidden'), 500);
    return;
  }

  if (!loadRes?.ok) {
    // Other model error (e.g. not pulled) — warn but enable
    setStep(stepModel, stepModelIcon, 'warn');
    showToast('⚠ Model check skipped — will load on first use');
  } else {
    setStep(stepModel, stepModelIcon, 'done');
  }

  // Step 3: Enable
  setStep(stepReady, stepReadyIcon, 'done');
  await send({ type: 'VG_SET_SETTINGS_PATCH', patch: { enabled: true, localLlmModel: selectedModel } });
  updateVisualState(true);
  enabledEl.disabled = false;
  showToast('✓ Protection active!');

  setTimeout(() => progressSection.classList.add('hidden'), 1500);
}

async function disableSequence() {
  enabledEl.disabled = true;
  const settings = (await send({ type: 'VG_GET_SETTINGS' }))?.settings || {};
  await send({ type: 'VG_SET_SETTINGS_PATCH', patch: { enabled: false } });
  updateVisualState(false);
  enabledEl.disabled = false;
  showToast('Model unloaded');
}

async function loadMetrics() {
  const response = await send({ type: 'VG_GET_METRICS' });
  if (!response?.ok || !response.metrics) return;
  const m = response.metrics;
  animateNumber(statRedacted, m.totalReplacements || 0);
  animateNumber(statRequests, m.totalTransforms || 0);
  animateNumber(statBlocked, m.totalBlocked || 0);
}

function animateNumber(el, target) {
  const current = parseInt(el.textContent) || 0;
  if (current === target) { el.textContent = formatNumber(target); return; }
  const duration = 400;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatNumber(Math.round(current + (target - current) * eased));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function load() {
  const response = await send({ type: 'VG_GET_SETTINGS' });
  if (!response?.ok) return;
  const s = response.settings;
  enabledEl.checked = !!s.enabled;
  updateVisualState(s.enabled);
  displayPolicy.textContent = s.failPolicy === 'pass' ? 'Pass through' : 'Block send';
}

// Event handlers
enabledEl.addEventListener('change', () => {
  if (enabledEl.checked) {
    enableSequence();
  } else {
    disableSequence();
  }
});

modelSelect.addEventListener('change', async () => {
  if (modelSelect.value) {
    await send({ type: 'VG_SET_SETTINGS_PATCH', patch: { localLlmModel: modelSelect.value } });
    showToast('✓ Model updated');
  }
});

// Boot
load();
checkOllama();
loadModels();
loadMetrics();

setInterval(checkOllama, 10000);
setInterval(loadMetrics, 5000);
