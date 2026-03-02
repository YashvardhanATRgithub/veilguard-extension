function send(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
            resolve(response || { ok: false });
        });
    });
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// Auto-detect platform
const platform = navigator.platform.toLowerCase();
if (platform.includes('win')) {
    document.querySelector('[data-tab="windows"]').click();
} else if (platform.includes('linux')) {
    document.querySelector('[data-tab="linux"]').click();
}

// Copy buttons
document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (cmd) {
            navigator.clipboard.writeText(cmd);
            btn.textContent = '✓';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        }
    });
});

// Status checking
const checkOllamaRow = document.getElementById('checkOllama');
const checkOllamaDetail = document.getElementById('checkOllamaDetail');
const checkModelRow = document.getElementById('checkModel');
const checkModelDetail = document.getElementById('checkModelDetail');

async function runChecks() {
    // Check 1: Ollama running
    checkOllamaRow.className = 'check-row';
    checkOllamaRow.querySelector('.check-icon').textContent = '⏳';
    checkOllamaDetail.textContent = 'Checking…';

    const ollamaRes = await send({ type: 'VG_CHECK_OLLAMA' });
    const ollamaOnline = !!(ollamaRes?.online);

    if (ollamaOnline) {
        checkOllamaRow.className = 'check-row pass';
        checkOllamaRow.querySelector('.check-icon').textContent = '✅';
        checkOllamaDetail.textContent = 'Running on port 11434';
    } else {
        checkOllamaRow.className = 'check-row fail';
        checkOllamaRow.querySelector('.check-icon').textContent = '❌';
        checkOllamaDetail.textContent = 'Not running — start Ollama first';
    }

    // Check 2: Model available
    checkModelRow.className = 'check-row';
    checkModelRow.querySelector('.check-icon').textContent = '⏳';
    checkModelDetail.textContent = 'Checking…';

    if (!ollamaOnline) {
        checkModelRow.className = 'check-row fail';
        checkModelRow.querySelector('.check-icon').textContent = '❌';
        checkModelDetail.textContent = 'Cannot check — Ollama is offline';
        return;
    }

    const modelsRes = await send({ type: 'VG_LIST_MODELS' });
    if (modelsRes?.ok && Array.isArray(modelsRes.models) && modelsRes.models.length > 0) {
        const names = modelsRes.models.map(m => m.name);
        const hasRecommended = names.some(n => n.includes('qwen'));
        checkModelRow.className = 'check-row pass';
        checkModelRow.querySelector('.check-icon').textContent = '✅';
        checkModelDetail.textContent = `${modelsRes.models.length} model(s) available` +
            (hasRecommended ? ' — recommended model found' : '');
    } else {
        checkModelRow.className = 'check-row fail';
        checkModelRow.querySelector('.check-icon').textContent = '❌';
        checkModelDetail.textContent = 'No models found — run: ollama pull qwen2.5:1.5b';
    }
}

document.getElementById('recheckBtn').addEventListener('click', runChecks);

// Run on load
runChecks();
