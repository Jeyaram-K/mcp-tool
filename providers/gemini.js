// Gemini Provider - Google Gemini API integration

class GeminiProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'gemini';
        this.label = 'Gemini';
        this.defaultModel = 'gemini-2.5-flash';
    }

    getEndpoint() {
        return `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
    }

    getHeaders() {
        return {
            'Authorization': `Bearer ${this.config.apiKey}`
        };
    }

    async sendMessage(messages, onChunk, signal, tools = null) {
        if (!this.config.apiKey) {
            throw new Error('Gemini API key not configured. Go to Settings to add your key.');
        }

        const body = {
            model: this.config.model || this.defaultModel,
            messages: messages,
            temperature: 0.7,
            max_tokens: 4096
        };

        // Add tools if provided
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
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/openai/models`,
                { headers: this.getHeaders() }
            );

            if (response.ok) {
                return { success: true, message: 'Connected to Gemini API' };
            } else {
                const err = await response.text();
                return { success: false, message: `Connection failed: ${err}` };
            }
        } catch (e) {
            return { success: false, message: `Connection error: ${e.message}` };
        }
    }
}

window.GeminiProvider = GeminiProvider;
