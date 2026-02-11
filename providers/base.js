// Base Provider - Shared utilities for all AI providers

class BaseProvider {
    constructor(config = {}) {
        this.config = config;
    }

    /**
     * Stream a chat completion response with tool call support
     * @param {string} url - API endpoint
     * @param {object} headers - Request headers
     * @param {object} body - Request body (may include tools)
     * @param {function} onChunk - Callback for each text chunk
     * @param {AbortSignal} signal - Abort signal
     * @returns {object|null} { toolCalls: [...] } if the model wants to call tools, null otherwise
     */
    async streamChat(url, headers, body, onChunk, signal) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ ...body, stream: true }),
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg;
            try {
                const errorJson = JSON.parse(errorText);
                errorMsg = errorJson.error?.message || errorJson.message || errorText;
            } catch { errorMsg = errorText; }
            throw new Error(`API Error (${response.status}): ${errorMsg}`);
        }

        const contentType = response.headers.get('content-type') || '';

        // Handle non-streaming JSON response
        if (contentType.includes('application/json')) {
            const result = await response.json();
            console.log('[MCP Chat] JSON response:', JSON.stringify(result).substring(0, 500));
            const choice = result.choices?.[0];
            const msg = choice?.message || choice?.delta;

            // Check for tool calls
            if (msg?.tool_calls && msg.tool_calls.length > 0) {
                return { toolCalls: msg.tool_calls, role: 'assistant', content: msg.content || null };
            }

            const content = msg?.content || '';
            if (content) onChunk(content);
            return null;
        }

        // Read SSE stream — collect both text content and tool_calls
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let gotContent = false;

        // Tool call accumulator (streaming sends them in pieces)
        const toolCallMap = {}; // index -> { id, type, function: { name, arguments } }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                let jsonData = null;
                if (trimmed.startsWith('data: ')) {
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') break;
                    try { jsonData = JSON.parse(data); } catch { }
                } else if (trimmed.startsWith('{')) {
                    try { jsonData = JSON.parse(trimmed); } catch { }
                }

                if (!jsonData) continue;

                const delta = jsonData.choices?.[0]?.delta;
                if (!delta) continue;

                // Accumulate text content
                if (delta.content) {
                    onChunk(delta.content);
                    gotContent = true;
                }

                // Accumulate tool calls (streamed in chunks)
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCallMap[idx]) {
                            toolCallMap[idx] = {
                                id: tc.id || `call_${idx}_${Date.now()}`,
                                type: 'function',
                                function: { name: '', arguments: '' }
                            };
                        }
                        if (tc.id) toolCallMap[idx].id = tc.id;
                        if (tc.function?.name) toolCallMap[idx].function.name += tc.function.name;
                        if (tc.function?.arguments) toolCallMap[idx].function.arguments += tc.function.arguments;
                    }
                }
            }
        }

        // Process remaining buffer
        if (buffer.trim()) {
            const data = buffer.trim().startsWith('data: ') ? buffer.trim().slice(6) : buffer.trim();
            if (data && data !== '[DONE]') {
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta?.content) { onChunk(delta.content); gotContent = true; }
                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!toolCallMap[idx]) {
                                toolCallMap[idx] = { id: tc.id || `call_${idx}`, type: 'function', function: { name: '', arguments: '' } };
                            }
                            if (tc.id) toolCallMap[idx].id = tc.id;
                            if (tc.function?.name) toolCallMap[idx].function.name += tc.function.name;
                            if (tc.function?.arguments) toolCallMap[idx].function.arguments += tc.function.arguments;
                        }
                    }
                } catch { }
            }
        }

        // Return tool calls if any
        const toolCalls = Object.values(toolCallMap);
        if (toolCalls.length > 0) {
            console.log('[MCP Chat] Tool calls detected:', toolCalls.map(t => t.function.name));
            return { toolCalls, role: 'assistant', content: null };
        }

        // If no content and no tool calls, try non-streaming fallback
        if (!gotContent) {
            console.warn('[MCP Chat] Stream empty, trying non-streaming fallback...');
            const fbResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ ...body, stream: false }),
                signal
            });
            if (fbResponse.ok) {
                const result = await fbResponse.json();
                const choice = result.choices?.[0];
                if (choice?.message?.tool_calls?.length > 0) {
                    return { toolCalls: choice.message.tool_calls, role: 'assistant', content: choice.message.content || null };
                }
                const content = choice?.message?.content || '';
                if (content) onChunk(content);
            }
        }

        return null;
    }

    async testConnection() {
        throw new Error('testConnection() must be implemented by subclass');
    }

    async sendMessage(messages, onChunk, signal) {
        throw new Error('sendMessage() must be implemented by subclass');
    }
}

window.BaseProvider = BaseProvider;
