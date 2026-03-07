(() => {
    const OLLAMA_BASE = 'http://127.0.0.1:11434';
    const STORAGE_KEY = 'veilguard_chat_conversations';
    const MAX_CONVERSATIONS = 50;

    // DOM refs
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggleSidebar');
    const newChatBtn = document.getElementById('newChatBtn');
    const conversationList = document.getElementById('conversationList');
    const chatMessages = document.getElementById('chatMessages');
    const welcomeScreen = document.getElementById('welcomeScreen');
    const chatTitle = document.getElementById('chatTitle');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const deleteChatBtn = document.getElementById('deleteChatBtn');
    const modelSelect = document.getElementById('modelSelect');
    const modelLabel = document.getElementById('modelLabel');
    const sidebarStatusDot = document.getElementById('sidebarStatusDot');
    const sidebarStatusText = document.getElementById('sidebarStatusText');

    let conversations = {};
    let activeId = null;
    let isStreaming = false;
    let abortController = null;

    // ── Storage ──
    async function loadConversations() {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        conversations = result[STORAGE_KEY] || {};
    }

    async function saveConversations() {
        await chrome.storage.local.set({ [STORAGE_KEY]: conversations });
    }

    // ── Ollama Status ──
    async function checkOllama() {
        try {
            const res = await fetch(OLLAMA_BASE + '/', { signal: AbortSignal.timeout(3000) });
            const online = res.ok;
            sidebarStatusDot.className = online ? 'status-dot online' : 'status-dot offline';
            sidebarStatusText.textContent = online ? 'Ollama Online' : 'Ollama Offline';
            return online;
        } catch {
            sidebarStatusDot.className = 'status-dot offline';
            sidebarStatusText.textContent = 'Ollama Offline';
            return false;
        }
    }

    async function loadModels() {
        try {
            const res = await fetch(OLLAMA_BASE + '/api/tags', { signal: AbortSignal.timeout(5000) });
            const data = await res.json();
            const models = data.models || [];
            modelSelect.innerHTML = '';
            for (const m of models) {
                const opt = document.createElement('option');
                opt.value = m.name;
                const sizeMB = m.size ? (m.size / 1e6).toFixed(0) + 'MB' : '';
                opt.textContent = sizeMB ? `${m.name} (${sizeMB})` : m.name;
                modelSelect.appendChild(opt);
            }
            // Try to restore last used model
            const stored = await chrome.storage.local.get('veilguard_chat_model');
            if (stored.veilguard_chat_model) {
                modelSelect.value = stored.veilguard_chat_model;
            }
            updateModelLabel();
        } catch {
            modelSelect.innerHTML = '<option value="qwen2.5:1.5b">qwen2.5:1.5b</option>';
        }
    }

    function updateModelLabel() {
        const name = modelSelect.value || 'qwen2.5:1.5b';
        modelLabel.textContent = name.split('(')[0].trim();
    }

    modelSelect.addEventListener('change', () => {
        chrome.storage.local.set({ veilguard_chat_model: modelSelect.value });
        updateModelLabel();
    });

    // ── Conversation Management ──
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function createConversation() {
        const id = generateId();
        conversations[id] = {
            id,
            title: 'New Chat',
            messages: [],
            model: modelSelect.value || 'qwen2.5:1.5b',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        pruneConversations();
        saveConversations();
        return id;
    }

    function pruneConversations() {
        const ids = Object.keys(conversations)
            .sort((a, b) => (conversations[b].updatedAt || 0) - (conversations[a].updatedAt || 0));
        while (ids.length > MAX_CONVERSATIONS) {
            delete conversations[ids.pop()];
        }
    }

    function deleteConversation(id) {
        delete conversations[id];
        saveConversations();
        if (activeId === id) {
            const remaining = Object.keys(conversations)
                .sort((a, b) => (conversations[b].updatedAt || 0) - (conversations[a].updatedAt || 0));
            if (remaining.length > 0) {
                switchToConversation(remaining[0]);
            } else {
                activeId = null;
                renderSidebar();
                showWelcome();
            }
        } else {
            renderSidebar();
        }
    }

    function autoTitle(text) {
        const cleaned = text.replace(/\n/g, ' ').trim();
        return cleaned.length > 40 ? cleaned.slice(0, 40) + '…' : cleaned;
    }

    // ── Sidebar Rendering ──
    function renderSidebar() {
        const sorted = Object.values(conversations)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        if (sorted.length === 0) {
            conversationList.innerHTML = '<div class="conv-empty">No conversations yet.<br>Start a new chat!</div>';
            return;
        }

        conversationList.innerHTML = '';
        for (const conv of sorted) {
            const el = document.createElement('div');
            el.className = 'conv-item' + (conv.id === activeId ? ' active' : '');
            el.innerHTML = `
        <svg class="conv-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="conv-item-text">${escapeHtml(conv.title)}</span>
      `;
            el.addEventListener('click', () => switchToConversation(conv.id));
            conversationList.appendChild(el);
        }
    }

    // ── Chat Rendering ──
    function showWelcome() {
        chatTitle.textContent = 'New Chat';
        chatMessages.innerHTML = '';
        chatMessages.appendChild(welcomeScreen);
        welcomeScreen.classList.remove('hidden');
        deleteChatBtn.classList.add('hidden');
    }

    function switchToConversation(id) {
        if (isStreaming) return;
        activeId = id;
        const conv = conversations[id];
        if (!conv) { showWelcome(); renderSidebar(); return; }

        chatTitle.textContent = conv.title;
        deleteChatBtn.classList.remove('hidden');
        renderMessages(conv.messages);
        renderSidebar();
        if (conv.model && modelSelect.querySelector(`option[value="${conv.model}"]`)) {
            modelSelect.value = conv.model;
            updateModelLabel();
        }
    }

    function renderMessages(messages) {
        chatMessages.innerHTML = '';
        welcomeScreen.classList.add('hidden');
        for (const msg of messages) {
            appendMessageBubble(msg.role, msg.content);
        }
        scrollToBottom();
    }

    function appendMessageBubble(role, content, streaming = false) {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        div.innerHTML = `
      <div class="message-inner">
        <div class="message-avatar">${role === 'user' ? 'Y' : 'AI'}</div>
        <div class="message-content ${streaming ? 'streaming-cursor' : ''}">${formatContent(content)}</div>
      </div>
    `;
        chatMessages.appendChild(div);
        scrollToBottom();
        return div;
    }

    function updateStreamingBubble(bubble, content) {
        const contentEl = bubble.querySelector('.message-content');
        if (contentEl) {
            contentEl.innerHTML = formatContent(content);
            scrollToBottom();
        }
    }

    function finalizeStreamingBubble(bubble, content) {
        const contentEl = bubble.querySelector('.message-content');
        if (contentEl) {
            contentEl.classList.remove('streaming-cursor');
            contentEl.innerHTML = formatContent(content);
        }
    }

    // ── Markdown-lite formatter ──
    function formatContent(text) {
        if (!text) return '';
        let html = escapeHtml(text);

        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
            `<pre><code>${code.trim()}</code></pre>`
        );

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Unordered lists
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Numbered lists
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        html = html.replace(/<p>\s*<\/p>/g, '');
        // Fix nested block elements inside paragraphs
        html = html.replace(/<p>(<pre>)/g, '$1');
        html = html.replace(/(<\/pre>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');

        return html;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    // ── Ollama Streaming ──
    async function sendMessage(text) {
        if (!text.trim() || isStreaming) return;

        // Ensure conversation exists
        if (!activeId || !conversations[activeId]) {
            activeId = createConversation();
        }

        const conv = conversations[activeId];
        conv.model = modelSelect.value || 'qwen2.5:1.5b';

        // Auto-title from first message
        if (conv.messages.length === 0) {
            conv.title = autoTitle(text);
            chatTitle.textContent = conv.title;
        }

        // Push user message
        conv.messages.push({ role: 'user', content: text });
        conv.updatedAt = Date.now();
        saveConversations();

        welcomeScreen.classList.add('hidden');
        appendMessageBubble('user', text);
        renderSidebar();
        deleteChatBtn.classList.remove('hidden');

        // Clear input
        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.disabled = true;

        // Stream response
        isStreaming = true;
        abortController = new AbortController();

        const assistantBubble = appendMessageBubble('assistant', '', true);
        let fullResponse = '';

        try {
            const ollamaMessages = conv.messages.map(m => ({ role: m.role, content: m.content }));
            const chatBody = JSON.stringify({
                model: conv.model,
                messages: ollamaMessages,
                stream: true
            });

            const res = await fetch(OLLAMA_BASE + '/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: chatBody,
                signal: abortController.signal
            });

            if (res.status === 403) {
                fullResponse = `⚠️ Error: Ollama returned 403 Forbidden. This means Ollama is blocking the extension. Please go to the VeilGuard Setup page and run the Windows CORS fix command.`;
                updateStreamingBubble(assistantBubble, fullResponse);
            } else if (!res.ok) {
                throw new Error(`Ollama returned ${res.status}`);
            } else {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(l => l.trim());

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.message?.content) {
                                fullResponse += data.message.content;
                                updateStreamingBubble(assistantBubble, fullResponse);
                            }
                        } catch { /* skip */ }
                    }
                }
            }

            // Save assistant response
            conv.messages.push({ role: 'assistant', content: fullResponse });
            conv.updatedAt = Date.now();
            saveConversations();

        } catch (error) {
            if (error.name === 'AbortError') {
                fullResponse += '\n\n*(generation stopped)*';
            } else {
                fullResponse = `⚠️ Error: ${error.message}. Make sure Ollama is running.`;
            }
        } finally {
            finalizeStreamingBubble(assistantBubble, fullResponse);
            isStreaming = false;
            abortController = null;
            updateSendButton();
        }
    }

    // ── Input Handling ──
    function updateSendButton() {
        sendBtn.disabled = !chatInput.value.trim() || isStreaming;
    }

    chatInput.addEventListener('input', () => {
        updateSendButton();
        // Auto-resize
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) sendMessage(chatInput.value);
        }
    });

    sendBtn.addEventListener('click', () => {
        if (!sendBtn.disabled) sendMessage(chatInput.value);
    });

    // ── Buttons ──
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    newChatBtn.addEventListener('click', () => {
        if (isStreaming) return;
        activeId = null;
        showWelcome();
        renderSidebar();
        chatInput.focus();
    });

    deleteChatBtn.addEventListener('click', () => {
        if (activeId && !isStreaming) {
            deleteConversation(activeId);
        }
    });

    // Quick-start chips
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chatInput.value = chip.dataset.prompt;
            updateSendButton();
            sendMessage(chatInput.value);
        });
    });

    // ── Init ──
    async function init() {
        await loadConversations();
        await checkOllama();
        await loadModels();
        renderSidebar();

        // Open most recent conversation or show welcome
        const sorted = Object.values(conversations)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (sorted.length > 0) {
            switchToConversation(sorted[0].id);
        } else {
            showWelcome();
        }

        chatInput.focus();

        // Periodic Ollama check
        setInterval(checkOllama, 30000);
    }

    init();
})();
