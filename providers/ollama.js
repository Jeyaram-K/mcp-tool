// Ollama Provider - Local Ollama integration

class OllamaProvider extends BaseProvider {
    constructor(config = {}) {
        super(config);
        this.name = 'ollama';
        this.label = 'Ollama';
        this.defaultModel = 'qwen3-vl:8b-instruct';
    }

    getEndpoint() {
        const baseUrl = this.config.url || 'http://localhost:11434';
        // Use Ollama's OpenAI compatible endpoint
        return `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    }

    getHeaders() {
        return {};
    }

    async sendMessage(messages, onChunk, signal, tools = null) {
        const body = {
            model: this.config.model || this.defaultModel,
            messages: messages,
            temperature: 0.7
        };

        // Add tools if provided
        if (tools && tools.length > 0) {
            body.tools = tools;
        }

        return await this.streamChat(this.getEndpoint(), this.getHeaders(), body, onChunk, signal);
    }

    async testConnection() {
        const baseUrl = this.config.url || 'http://localhost:11434';

        try {
            const response = await fetch(
                `${baseUrl.replace(/\/$/, '')}/v1/models`,
                { headers: this.getHeaders() }
            );

            if (response.ok) {
                return { success: true, message: 'Connected to Ollama' };
            } else {
                const err = await response.text();
                return { success: false, message: `Connection failed: ${err}` };
            }
        } catch (e) {
            return { success: false, message: `Connection error: Ensure Ollama is running and accessible (${e.message})` };
        }
    }
}

window.OllamaProvider = OllamaProvider;
