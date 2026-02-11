// OpenRouter Provider - OpenRouter API integration

class OpenRouterProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'openrouter';
        this.label = 'OpenRouter';
        this.defaultModel = 'google/gemini-2.0-flash-001';
    }

    getEndpoint() {
        return 'https://openrouter.ai/api/v1/chat/completions';
    }

    getHeaders() {
        return {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'HTTP-Referer': chrome.runtime.getURL(''),
            'X-Title': 'MCP Chat Extension'
        };
    }

    async sendMessage(messages, onChunk, signal, tools = null) {
        if (!this.config.apiKey) {
            throw new Error('OpenRouter API key not configured. Go to Settings to add your key.');
        }

        const body = {
            model: this.config.model || this.defaultModel,
            messages: messages,
            temperature: 0.7,
            max_tokens: 4096
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = 'auto';
        }

        return await this.streamChat(this.getEndpoint(), this.getHeaders(), body, onChunk, signal);
    }

    async testConnection() {
        if (!this.config.apiKey) {
            return { success: false, message: 'API key not set' };
        }

        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                headers: this.getHeaders()
            });

            if (response.ok) {
                return { success: true, message: 'Connected to OpenRouter API' };
            } else {
                const err = await response.text();
                return { success: false, message: `Connection failed: ${err}` };
            }
        } catch (e) {
            return { success: false, message: `Connection error: ${e.message}` };
        }
    }
}

window.OpenRouterProvider = OpenRouterProvider;
