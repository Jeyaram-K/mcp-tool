// MCP Chat - Side Panel Controller
// Main application logic for chat, settings, tools, and provider management

(function () {
    'use strict';

    // ===== State =====
    let chatHistory = [];
    let currentProvider = null;
    let providers = {};
    let mcpClient = null;
    let abortController = null;
    let isStreaming = false;
    let settings = {};

    // ===== DOM Elements =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const elements = {
        providerSelect: $('#providerSelect'),
        statusDot: $('#statusDot'),
        messages: $('#messages'),
        chatInput: $('#chatInput'),
        sendBtn: $('#sendBtn'),
        stopBtn: $('#stopBtn'),
        attachPageBtn: $('#attachPageBtn'),
        clearChatBtn: $('#clearChatBtn'),
        browserTools: $('#browserTools'),
        mcpServerTools: $('#mcpServerTools'),
        toolOutput: $('#toolOutput'),
        toolOutputContent: $('#toolOutputContent'),
        closeToolOutput: $('#closeToolOutput'),
        refreshToolsBtn: $('#refreshToolsBtn'),
        goToSettingsBtn: $('#goToSettingsBtn'),
        saveSettingsBtn: $('#saveSettingsBtn'),
        testConnectionBtn: $('#testConnectionBtn'),
        resetSettingsBtn: $('#resetSettingsBtn'),
        toast: $('#toast')
    };

    // ===== Init =====
    async function init() {
        await loadSettings();
        initProviders();
        setupEventListeners();
        renderBrowserTools();
        await loadChatHistory();
        initMCPClient();
    }

    // ===== Settings Management =====
    async function loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['mcpChatSettings'], (result) => {
                settings = result.mcpChatSettings || getDefaultSettings();
                applySettingsToUI();
                resolve();
            });
        });
    }

    function getDefaultSettings() {
        return {
            activeProvider: 'gemini',
            gemini: { apiKey: '', model: 'gemini-2.0-flash' },
            ollama: { url: 'http://localhost:11434', model: 'llama3.2' },
            groq: { apiKey: '', model: 'llama-3.3-70b-versatile' },
            openrouter: { apiKey: '', model: 'google/gemini-2.0-flash-001' },
            mcpConfig: JSON.stringify({
                mcpServers: {
                    bridge: {
                        url: 'http://localhost:3100/sse',
                        transport: 'sse'
                    }
                }
            }, null, 2),
            systemPrompt: 'You are a helpful AI assistant with access to MCP browser tools. You can help users interact with web pages, summarize content, and use various tools to accomplish tasks. When asked to use a tool, execute it and share the results.'
        };
    }

    function applySettingsToUI() {
        elements.providerSelect.value = settings.activeProvider || 'gemini';
        $('#geminiKey').value = settings.gemini?.apiKey || '';
        $('#geminiModel').value = settings.gemini?.model || 'gemini-2.0-flash';
        $('#ollamaUrl').value = settings.ollama?.url || 'http://localhost:11434';
        $('#ollamaModel').value = settings.ollama?.model || 'llama3.2';
        $('#groqKey').value = settings.groq?.apiKey || '';
        $('#groqModel').value = settings.groq?.model || 'llama-3.3-70b-versatile';
        $('#openrouterKey').value = settings.openrouter?.apiKey || '';
        $('#openrouterModel').value = settings.openrouter?.model || 'google/gemini-2.0-flash-001';
        $('#mcpConfig').value = settings.mcpConfig || '';
        $('#systemPrompt').value = settings.systemPrompt || '';
    }

    function gatherSettingsFromUI() {
        settings = {
            activeProvider: elements.providerSelect.value,
            gemini: {
                apiKey: $('#geminiKey').value.trim(),
                model: $('#geminiModel').value.trim() || 'gemini-2.0-flash'
            },
            ollama: {
                url: $('#ollamaUrl').value.trim() || 'http://localhost:11434',
                model: $('#ollamaModel').value.trim() || 'llama3.2'
            },
            groq: {
                apiKey: $('#groqKey').value.trim(),
                model: $('#groqModel').value.trim() || 'llama-3.3-70b-versatile'
            },
            openrouter: {
                apiKey: $('#openrouterKey').value.trim(),
                model: $('#openrouterModel').value.trim() || 'google/gemini-2.0-flash-001'
            },
            mcpConfig: $('#mcpConfig').value.trim(),
            systemPrompt: $('#systemPrompt').value.trim()
        };
    }

    async function saveSettings() {
        gatherSettingsFromUI();
        return new Promise((resolve) => {
            chrome.storage.local.set({ mcpChatSettings: settings }, () => {
                initProviders();
                initMCPClient();
                resolve();
            });
        });
    }

    // ===== Provider Management =====
    function initProviders() {
        providers = {
            gemini: new GeminiProvider(settings.gemini || {}),
            ollama: new OllamaProvider(settings.ollama || {}),
            groq: new GroqProvider(settings.groq || {}),
            openrouter: new OpenRouterProvider(settings.openrouter || {})
        };

        const activeProviderName = settings.activeProvider || 'gemini';
        currentProvider = providers[activeProviderName];
        elements.providerSelect.value = activeProviderName;
        updateStatusDot();
    }

    function switchProvider(providerName) {
        settings.activeProvider = providerName;
        currentProvider = providers[providerName];
        updateStatusDot();
        chrome.storage.local.set({ mcpChatSettings: settings });
    }

    function updateStatusDot() {
        const name = settings.activeProvider;
        const hasConfig = name === 'ollama' || settings[name]?.apiKey;
        elements.statusDot.classList.toggle('connected', !!hasConfig);
        elements.statusDot.title = hasConfig ? `${currentProvider.label} configured` : `${currentProvider?.label || name} not configured`;
    }

    // ===== MCP Client =====
    function initMCPClient() {
        if (mcpClient) mcpClient.disconnectAll();
        mcpClient = new MCPClient();

        if (settings.mcpConfig) {
            try {
                const config = JSON.parse(settings.mcpConfig);
                mcpClient.loadConfig(config);
                mcpClient.connectAll().then((tools) => {
                    renderMCPServerTools(tools);
                    if (tools.length > 0) {
                        showToast(`Connected! ${tools.length} MCP tools available`, 'success');
                    }
                }).catch(err => {
                    console.error('MCP connection error:', err);
                    showToast('MCP connection failed. Is the bridge running?', 'error');
                });
            } catch (e) {
                console.error('Invalid MCP config JSON:', e);
                showToast('Invalid MCP config JSON', 'error');
            }
        }
    }

    // ===== Chat =====
    async function sendMessage(userText) {
        if (!userText.trim() || isStreaming) return;

        // Remove welcome message
        const welcome = $('.welcome-message');
        if (welcome) welcome.remove();

        // Add user message
        addMessageToUI('user', userText);
        chatHistory.push({ role: 'user', content: userText });

        // Collect all available tools in OpenAI function format
        const allTools = [];

        // Browser tools
        const browserFns = BrowserTools.toOpenAIFunctions(BrowserTools.list);
        allTools.push(...browserFns);

        // MCP server tools
        if (mcpClient) {
            const mcpTools = mcpClient.getAllTools();
            for (const t of mcpTools) {
                allTools.push({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description || '',
                        parameters: t.inputSchema || { type: 'object', properties: {} }
                    }
                });
            }
        }

        // Prepare system message
        const systemContent = settings.systemPrompt || 'You are a helpful AI assistant with access to browser tools and MCP tools.';

        // Build messages
        const messages = [
            { role: 'system', content: systemContent },
            ...chatHistory
        ];

        // Create assistant message element
        const assistantEl = addMessageToUI('assistant', '');
        const contentEl = assistantEl.querySelector('.message-content');

        // Show typing indicator
        contentEl.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

        // Start streaming
        isStreaming = true;
        elements.sendBtn.style.display = 'none';
        elements.stopBtn.style.display = 'flex';
        elements.chatInput.disabled = true;
        abortController = new AbortController();

        let fullResponse = '';
        const MAX_TOOL_ITERATIONS = 5;

        try {
            // Tool call loop: send → detect tool calls → execute → send results → repeat
            for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                let toolCallResult = null;

                toolCallResult = await currentProvider.sendMessage(messages, (chunk) => {
                    if (fullResponse === '') {
                        contentEl.innerHTML = '';
                    }
                    fullResponse += chunk;
                    contentEl.innerHTML = renderMarkdown(fullResponse);
                    elements.messages.scrollTop = elements.messages.scrollHeight;
                }, abortController.signal, allTools.length > 0 ? allTools : null);

                // If no tool calls, we're done
                if (!toolCallResult || !toolCallResult.toolCalls || toolCallResult.toolCalls.length === 0) {
                    break;
                }

                // AI wants to call tools! Show status and execute them
                console.log('[MCP Chat] Tool calls:', toolCallResult.toolCalls);

                // Add assistant message with tool calls to conversation
                const assistantToolMsg = {
                    role: 'assistant',
                    content: toolCallResult.content || null,
                    tool_calls: toolCallResult.toolCalls
                };
                messages.push(assistantToolMsg);

                // Show tool execution in UI
                fullResponse += '\n\n';

                for (const toolCall of toolCallResult.toolCalls) {
                    const fnName = toolCall.function?.name || 'unknown';
                    let fnArgs = {};
                    try {
                        fnArgs = JSON.parse(toolCall.function?.arguments || '{}');
                    } catch {
                        fnArgs = {};
                    }

                    fullResponse += `🔧 **Executing:** \`${fnName}\``;
                    if (Object.keys(fnArgs).length > 0) {
                        fullResponse += ` with ${JSON.stringify(fnArgs)}`;
                    }
                    fullResponse += '\n';
                    contentEl.innerHTML = renderMarkdown(fullResponse);
                    elements.messages.scrollTop = elements.messages.scrollHeight;

                    // Execute the tool
                    let toolResult;
                    try {
                        toolResult = await executeToolByName(fnName, fnArgs);
                        fullResponse += `✅ **Result:** ${truncateResult(toolResult)}\n\n`;
                    } catch (err) {
                        toolResult = { error: err.message };
                        fullResponse += `❌ **Error:** ${err.message}\n\n`;
                    }

                    contentEl.innerHTML = renderMarkdown(fullResponse);
                    elements.messages.scrollTop = elements.messages.scrollHeight;

                    // Add tool result to messages for next iteration
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(toolResult)
                    });
                }

                // Show typing again for the AI's follow-up response
                fullResponse += '---\n\n';
                contentEl.innerHTML = renderMarkdown(fullResponse) + '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            }

            if (!fullResponse) {
                contentEl.innerHTML = '<span style="color: var(--warning)">⚠ No response received. Check your API key in Settings and ensure the selected provider is configured correctly.</span>';
                chatHistory.pop();
            } else {
                chatHistory.push({ role: 'assistant', content: fullResponse });
                saveChatHistory();
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                contentEl.innerHTML += '<br><span style="color: var(--warning); font-size: 11px;">⚠ Response cancelled</span>';
            } else {
                contentEl.innerHTML = `<div class="error-message">❌ ${escapeHtml(error.message)}</div>`;
                console.error('[MCP Chat] Error:', error);
            }
            chatHistory.pop();
        } finally {
            isStreaming = false;
            elements.sendBtn.style.display = 'flex';
            elements.stopBtn.style.display = 'none';
            elements.chatInput.disabled = false;
            elements.chatInput.focus();
            abortController = null;
        }
    }

    /**
     * Execute a tool by name — checks browser tools first, then MCP tools
     */
    async function executeToolByName(name, args = {}) {
        // Check browser tools
        const browserTool = BrowserTools.list.find(t => t.name === name);
        if (browserTool) {
            return await browserTool.execute(args);
        }

        // Check MCP tools
        if (mcpClient) {
            const mcpTool = mcpClient.getAllTools().find(t => t.name === name);
            if (mcpTool && mcpTool.execute) {
                return await mcpTool.execute(args);
            }
        }

        throw new Error(`Unknown tool: ${name}`);
    }

    /**
     * Truncate long tool results for display
     */
    function truncateResult(result) {
        const str = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        if (str.length > 500) {
            return '```\n' + str.substring(0, 500) + '...\n```';
        }
        return '```\n' + str + '\n```';
    }

    function addMessageToUI(role, content) {
        const msgEl = document.createElement('div');
        msgEl.className = `message ${role}`;

        const avatar = role === 'user' ? 'U' : '✦';

        const editButtonHtml = role === 'user' ? `
        <button class="edit-msg-btn" title="Edit message">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        </button>
    ` : '';

        // Store original content
        msgEl.dataset.originalContent = content || '';

        msgEl.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-content-wrapper">
          <div class="message-content" data-role="${role}">${content ? renderMarkdown(content) : ''}</div>
          ${editButtonHtml}
      </div>
    `;

        // Add edit functionality
        if (role === 'user') {
            const editBtn = msgEl.querySelector('.edit-msg-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    const contentEl = msgEl.querySelector('.message-content');
                    const contentWrapper = msgEl.querySelector('.message-content-wrapper');

                    // Switch to edit mode
                    const originalContent = msgEl.dataset.originalContent;

                    // Hide normal content and edit button
                    contentEl.style.display = 'none';
                    editBtn.style.display = 'none';

                    // Create edit interface
                    const editInterface = document.createElement('div');
                    editInterface.className = 'edit-interface';
                    editInterface.innerHTML = `
                    <textarea class="edit-textarea">${originalContent}</textarea>
                    <div class="edit-actions">
                        <button class="btn btn-secondary cancel-edit-btn">Cancel</button>
                        <button class="btn btn-primary save-edit-btn">Save & Send</button>
                    </div>
                `;

                    contentWrapper.appendChild(editInterface);

                    const textarea = editInterface.querySelector('.edit-textarea');
                    textarea.style.height = 'auto';
                    textarea.style.height = Math.min(Math.max(textarea.scrollHeight, 40), 120) + 'px';
                    textarea.focus();

                    // Auto-resize textarea
                    textarea.addEventListener('input', () => {
                        textarea.style.height = 'auto';
                        textarea.style.height = Math.min(Math.max(textarea.scrollHeight, 40), 120) + 'px';
                    });

                    // Handle Cancel
                    editInterface.querySelector('.cancel-edit-btn').addEventListener('click', () => {
                        editInterface.remove();
                        contentEl.style.display = 'block';
                        editBtn.style.display = 'flex';
                    });

                    // Handle Save
                    editInterface.querySelector('.save-edit-btn').addEventListener('click', () => {
                        const newContent = textarea.value.trim();
                        if (!newContent) return;
                        if (isStreaming) return; // Don't allow if already streaming

                        // Update dataset and remove interface
                        msgEl.dataset.originalContent = newContent;
                        editInterface.remove();
                        contentEl.innerHTML = renderMarkdown(newContent);
                        contentEl.style.display = 'block';
                        editBtn.style.display = 'flex';

                        // We need to resend from this point.
                        // Find index of this message in DOM to slice chat history
                        const messagesContainer = document.getElementById('messages');
                        const allMessages = Array.from(messagesContainer.querySelectorAll('.message'));
                        const msgIndex = allMessages.indexOf(msgEl);

                        if (msgIndex !== -1) {
                            // Remove all subsequent messages from DOM
                            for (let i = allMessages.length - 1; i > msgIndex; i--) {
                                allMessages[i].remove();
                            }

                            // Update chat history
                            chatHistory = chatHistory.slice(0, msgIndex);
                            // Make sure we update chat history with the new content
                            chatHistory.push({ role: 'user', content: newContent });
                            saveChatHistory();

                            // Resend the message logic - copy logic from sendMessage
                            const allTools = [];
                            const browserFns = BrowserTools.toOpenAIFunctions(BrowserTools.list);
                            allTools.push(...browserFns);

                            if (mcpClient) {
                                const mcpTools = mcpClient.getAllTools();
                                for (const t of mcpTools) {
                                    allTools.push({
                                        type: 'function',
                                        function: {
                                            name: t.name,
                                            description: t.description || '',
                                            parameters: t.inputSchema || { type: 'object', properties: {} }
                                        }
                                    });
                                }
                            }

                            const systemContent = settings.systemPrompt || 'You are a helpful AI assistant with access to browser tools and MCP tools.';
                            const messages = [
                                { role: 'system', content: systemContent },
                                ...chatHistory
                            ];

                            const assistantEl = addMessageToUI('assistant', '');
                            const newContentEl = assistantEl.querySelector('.message-content');
                            newContentEl.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

                            isStreaming = true;
                            if (elements.sendBtn) elements.sendBtn.style.display = 'none';
                            if (elements.stopBtn) elements.stopBtn.style.display = 'flex';
                            if (elements.chatInput) elements.chatInput.disabled = true;
                            abortController = new AbortController();

                            let fullResponse = '';
                            const MAX_TOOL_ITERATIONS = 5;

                            (async () => {
                                try {
                                    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                                        let toolCallResult = null;

                                        toolCallResult = await currentProvider.sendMessage(messages, (chunk) => {
                                            if (fullResponse === '') newContentEl.innerHTML = '';
                                            fullResponse += chunk;
                                            newContentEl.innerHTML = renderMarkdown(fullResponse);
                                            elements.messages.scrollTop = elements.messages.scrollHeight;
                                        }, abortController.signal, allTools.length > 0 ? allTools : null);

                                        if (!toolCallResult || !toolCallResult.toolCalls || toolCallResult.toolCalls.length === 0) {
                                            break;
                                        }

                                        const assistantToolMsg = {
                                            role: 'assistant',
                                            content: toolCallResult.content || null,
                                            tool_calls: toolCallResult.toolCalls
                                        };
                                        messages.push(assistantToolMsg);

                                        fullResponse += '\n\n';

                                        for (const toolCall of toolCallResult.toolCalls) {
                                            const fnName = toolCall.function?.name || 'unknown';
                                            let fnArgs = {};
                                            try { fnArgs = JSON.parse(toolCall.function?.arguments || '{}'); } catch { fnArgs = {}; }

                                            fullResponse += `🔧 **Executing:** \`${fnName}\``;
                                            if (Object.keys(fnArgs).length > 0) fullResponse += ` with ${JSON.stringify(fnArgs)}`;
                                            fullResponse += '\n';
                                            newContentEl.innerHTML = renderMarkdown(fullResponse);
                                            elements.messages.scrollTop = elements.messages.scrollHeight;

                                            let toolResult;
                                            try {
                                                toolResult = await executeToolByName(fnName, fnArgs);
                                                fullResponse += `✅ **Result:** ${truncateResult(toolResult)}\n\n`;
                                            } catch (err) {
                                                toolResult = { error: err.message };
                                                fullResponse += `❌ **Error:** ${err.message}\n\n`;
                                            }

                                            newContentEl.innerHTML = renderMarkdown(fullResponse);
                                            elements.messages.scrollTop = elements.messages.scrollHeight;

                                            messages.push({
                                                role: 'tool',
                                                tool_call_id: toolCall.id,
                                                content: JSON.stringify(toolResult)
                                            });
                                        }

                                        fullResponse += '---\n\n';
                                        newContentEl.innerHTML = renderMarkdown(fullResponse) + '<div class="typing-indicator"><span></span><span></span><span></span></div>';
                                    }

                                    if (!fullResponse) {
                                        newContentEl.innerHTML = '<span style="color: var(--warning)">⚠ No response received. Check your API key in Settings and ensure the selected provider is configured correctly.</span>';
                                        chatHistory.pop(); // Remove assistant message
                                    } else {
                                        chatHistory.push({ role: 'assistant', content: fullResponse });
                                        saveChatHistory();
                                    }

                                } catch (error) {
                                    if (error.name === 'AbortError') {
                                        newContentEl.innerHTML += '<br><span style="color: var(--warning); font-size: 11px;">⚠ Response cancelled</span>';
                                    } else {
                                        newContentEl.innerHTML = `<div class="error-message">❌ ${escapeHtml(error.message)}</div>`;
                                    }
                                    chatHistory.pop();
                                } finally {
                                    isStreaming = false;
                                    if (elements.sendBtn) elements.sendBtn.style.display = 'flex';
                                    if (elements.stopBtn) elements.stopBtn.style.display = 'none';
                                    if (elements.chatInput) elements.chatInput.disabled = false;
                                    if (elements.chatInput) elements.chatInput.focus();
                                    abortController = null;
                                }
                            })();
                        }
                    });
                });
            }
        }

        elements.messages.appendChild(msgEl);
        elements.messages.scrollTop = elements.messages.scrollHeight;
        return msgEl;
    }

    async function saveChatHistory() {
        // Keep last 50 messages to avoid storage overflow
        const trimmed = chatHistory.slice(-50);
        chrome.storage.local.set({ mcpChatHistory: trimmed });
    }

    async function loadChatHistory() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['mcpChatHistory'], (result) => {
                chatHistory = result.mcpChatHistory || [];
                if (chatHistory.length > 0) {
                    const welcome = $('.welcome-message');
                    if (welcome) welcome.remove();

                    chatHistory.forEach(msg => {
                        addMessageToUI(msg.role, msg.content);
                    });
                }
                resolve();
            });
        });
    }

    function clearChat() {
        chatHistory = [];
        elements.messages.innerHTML = `
      <div class="welcome-message">
        <div class="welcome-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#4F46E5" opacity="0.3"/>
            <path d="M2 17l10 5 10-5" stroke="#7C3AED" stroke-width="1.5" fill="none"/>
            <path d="M2 12l10 5 10-5" stroke="#4F46E5" stroke-width="1.5" fill="none"/>
          </svg>
        </div>
        <h2>Welcome to MCP Chat</h2>
        <p>Chat with AI using Gemini, Ollama, Groq, or OpenRouter. Access MCP tools to interact with your browser.</p>
        <div class="quick-actions">
          <button class="quick-action" data-prompt="Summarize this page">📄 Summarize Page</button>
          <button class="quick-action" data-prompt="Explain the selected text">🔍 Explain Selection</button>
          <button class="quick-action" data-prompt="What MCP tools are available?">🔧 List Tools</button>
        </div>
      </div>
    `;
        chrome.storage.local.remove('mcpChatHistory');
        showToast('Chat cleared', 'success');
        setupQuickActions();
    }

    // ===== Markdown Rendering =====
    function renderMarkdown(text) {
        if (!text) return '';

        // Use marked library if available
        if (typeof marked !== 'undefined') {
            try {
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    headerIds: false,
                    mangle: false
                });
                return marked.parse(text);
            } catch (e) {
                console.warn('[MCP Chat] Marked parse error, using fallback:', e);
            }
        }

        // Fallback: basic markdown rendering
        let html = escapeHtml(text);
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
            `<pre><code class="language-${lang}">${code.trim()}</code></pre>`);
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== Tools UI =====
    function renderBrowserTools() {
        const tools = BrowserTools.list;
        elements.browserTools.innerHTML = tools.map(tool => `
      <div class="tool-card" data-tool="${tool.name}" data-source="browser">
        <div class="tool-card-name">
          <span class="tool-icon">${tool.icon}</span>
          ${tool.name}
        </div>
        <div class="tool-card-desc">${tool.description}</div>
      </div>
    `).join('');
    }

    function renderMCPServerTools(tools) {
        if (!tools || tools.length === 0) {
            elements.mcpServerTools.innerHTML = `
        <div class="empty-state">
          <p>No MCP servers configured</p>
          <button class="link-btn" id="goToSettingsBtn2">Configure in Settings →</button>
        </div>
      `;
            const btn = $('#goToSettingsBtn2');
            if (btn) btn.addEventListener('click', () => switchTab('settings'));
            return;
        }

        elements.mcpServerTools.innerHTML = tools.map(tool => `
      <div class="tool-card" data-tool="${tool.name}" data-source="mcp" data-server="${tool.serverName}">
        <div class="tool-card-name">
          <span class="tool-icon">${tool.icon}</span>
          ${tool.name}
          <span style="font-size:10px; color:var(--text-muted); margin-left:auto;">${tool.serverName}</span>
        </div>
        <div class="tool-card-desc">${tool.description}</div>
      </div>
    `).join('');
    }

    async function executeTool(toolName, source, serverName) {
        try {
            elements.toolOutput.style.display = 'block';
            elements.toolOutputContent.textContent = `⏳ Executing ${toolName}...`;

            let result;
            if (source === 'browser') {
                result = await BrowserTools.execute(toolName);
            } else if (source === 'mcp') {
                const tool = mcpClient.getAllTools().find(t => t.name === toolName && t.serverName === serverName);
                if (tool) {
                    result = await tool.execute({});
                } else {
                    throw new Error(`Tool ${toolName} not found`);
                }
            }

            // Format result - handle MCP content array format
            let formatted;
            if (result && result.content && Array.isArray(result.content)) {
                formatted = result.content.map(c => c.text || JSON.stringify(c)).join('\n');
            } else {
                formatted = JSON.stringify(result, null, 2);
            }
            elements.toolOutputContent.textContent = formatted;

            // Store last tool result so user can send to chat
            lastToolResult = { toolName, result: formatted };

            showToast('Tool executed! Click "Use in Chat" to send result to AI.', 'success');
        } catch (error) {
            elements.toolOutputContent.textContent = `Error: ${error.message}`;
            showToast(`Tool error: ${error.message}`, 'error');
        }
    }

    // Send last tool result to chat
    let lastToolResult = null;
    function sendToolResultToChat() {
        if (!lastToolResult) return;
        const toolMsg = `[Tool: ${lastToolResult.toolName}]\n${lastToolResult.result.substring(0, 5000)}`;
        const currentText = elements.chatInput.value;
        elements.chatInput.value = currentText + (currentText ? '\n\n' : '') + toolMsg;
        elements.chatInput.style.height = 'auto';
        elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
        switchTab('chat');
        elements.chatInput.focus();
        showToast('Tool result added to chat input', 'success');
    }

    // ===== Attach Page Content =====
    async function attachPageContent() {
        try {
            const result = await BrowserTools.execute('get_page_content');
            const pageInfo = `[Attached Page Content]\nTitle: ${result.title}\nURL: ${result.url}\n\n${result.content.substring(0, 5000)}`;

            const currentText = elements.chatInput.value;
            elements.chatInput.value = currentText + (currentText ? '\n\n' : '') + pageInfo;
            elements.chatInput.style.height = 'auto';
            elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
            elements.chatInput.focus();
            showToast('Page content attached', 'success');
        } catch (error) {
            showToast(`Failed to get page content: ${error.message}`, 'error');
        }
    }

    // ===== Tab Management =====
    function switchTab(tabName) {
        $$('.tab').forEach(t => t.classList.remove('active'));
        $$('.panel').forEach(p => p.classList.remove('active'));

        $(`[data-tab="${tabName}"]`).classList.add('active');
        $(`#${tabName}Panel`).classList.add('active');
    }

    // ===== Toast =====
    function showToast(message, type = '') {
        elements.toast.textContent = message;
        elements.toast.className = `toast show ${type}`;
        setTimeout(() => {
            elements.toast.classList.remove('show');
        }, 3000);
    }

    // ===== Test Connection =====
    async function testConnection() {
        const providerName = elements.providerSelect.value;
        gatherSettingsFromUI();
        initProviders();

        const provider = providers[providerName];
        showToast(`Testing ${provider.label} connection...`);

        try {
            const result = await provider.testConnection();
            const statusEl = $(`#${providerName}Status`);
            if (result.success) {
                statusEl.textContent = '✓ Connected';
                statusEl.className = 'connection-status active';
                showToast(result.message, 'success');
            } else {
                statusEl.textContent = '✗ Failed';
                statusEl.className = 'connection-status';
                showToast(result.message, 'error');
            }
        } catch (e) {
            showToast(`Test failed: ${e.message}`, 'error');
        }
    }

    // ===== Quick Actions =====
    function setupQuickActions() {
        $$('.quick-action').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                elements.chatInput.value = prompt;
                elements.chatInput.focus();
            });
        });
    }

    // ===== Event Listeners =====
    function setupEventListeners() {
        // Tab switching
        $$('.tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        // Provider switching
        elements.providerSelect.addEventListener('change', (e) => {
            switchProvider(e.target.value);
        });

        // Send message
        elements.sendBtn.addEventListener('click', () => {
            const text = elements.chatInput.value.trim();
            if (text && !isStreaming) {
                elements.chatInput.value = '';
                elements.chatInput.style.height = 'auto';
                sendMessage(text);
            }
        });

        // Stop generating
        elements.stopBtn.addEventListener('click', () => {
            if (isStreaming && abortController) {
                abortController.abort();
            }
        });

        // Enter to send (Shift+Enter for newline)
        elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                elements.sendBtn.click();
            }
        });

        // Auto-resize textarea
        elements.chatInput.addEventListener('input', () => {
            elements.chatInput.style.height = 'auto';
            elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
        });

        // Attach page content
        elements.attachPageBtn.addEventListener('click', attachPageContent);

        // Clear chat
        elements.clearChatBtn.addEventListener('click', clearChat);

        // Quick actions
        setupQuickActions();

        // Tool cards - click to execute
        document.addEventListener('click', (e) => {
            const toolCard = e.target.closest('.tool-card');
            if (toolCard) {
                const toolName = toolCard.dataset.tool;
                const source = toolCard.dataset.source;
                const server = toolCard.dataset.server;
                executeTool(toolName, source, server);
            }
        });

        // Close tool output
        elements.closeToolOutput.addEventListener('click', () => {
            elements.toolOutput.style.display = 'none';
        });

        // Use tool result in chat
        const useInChatBtn = document.getElementById('useInChatBtn');
        if (useInChatBtn) {
            useInChatBtn.addEventListener('click', sendToolResultToChat);
        }

        // Refresh tools
        elements.refreshToolsBtn.addEventListener('click', () => {
            renderBrowserTools();
            if (mcpClient) {
                mcpClient.connectAll().then(tools => {
                    renderMCPServerTools(tools);
                    showToast('Tools refreshed', 'success');
                }).catch(err => {
                    showToast(`Refresh failed: ${err.message}`, 'error');
                });
            }
        });

        // Go to settings from tools panel
        elements.goToSettingsBtn?.addEventListener('click', () => switchTab('settings'));

        // Save settings
        elements.saveSettingsBtn.addEventListener('click', async () => {
            await saveSettings();
            showToast('Settings saved!', 'success');
            updateStatusDot();
        });

        // Test connection
        elements.testConnectionBtn.addEventListener('click', testConnection);

        // Reset settings
        elements.resetSettingsBtn.addEventListener('click', () => {
            if (confirm('Reset all settings to defaults?')) {
                settings = getDefaultSettings();
                applySettingsToUI();
                saveSettings();
                showToast('Settings reset to defaults', 'success');
            }
        });

        // Toggle password visibility
        $$('.toggle-visibility').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = $(`#${btn.dataset.target}`);
                if (target.type === 'password') {
                    target.type = 'text';
                    btn.textContent = '🔒';
                } else {
                    target.type = 'password';
                    btn.textContent = '👁';
                }
            });
        });
    }

    // ===== Start =====
    document.addEventListener('DOMContentLoaded', init);
})();
