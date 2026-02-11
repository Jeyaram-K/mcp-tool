// MCP Tools - Built-in browser tools with MCP-compatible schemas

const BROWSER_TOOLS = [
    {
        name: 'get_page_content',
        description: 'Get the text content, title, and URL of the current active tab',
        icon: '📄',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' }, (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve({
                            title: response.data.title,
                            url: response.data.url,
                            content: response.data.content,
                            meta: response.data.meta
                        });
                    }
                });
            });
        }
    },
    {
        name: 'get_selected_text',
        description: 'Get the currently selected/highlighted text from the active tab',
        icon: '🔍',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'GET_SELECTED_TEXT' }, (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve({ selectedText: response.data || '(No text selected)' });
                    }
                });
            });
        }
    },
    {
        name: 'get_page_metadata',
        description: 'Get metadata (title, URL, description, keywords) from the current tab',
        icon: '🏷️',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' }, (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve({
                            title: response.data.title,
                            url: response.data.url,
                            description: response.data.meta?.description || '',
                            keywords: response.data.meta?.keywords || ''
                        });
                    }
                });
            });
        }
    },
    {
        name: 'capture_screenshot',
        description: 'Capture a screenshot of the current visible tab',
        icon: '📸',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }, (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve({ screenshot: response.data, format: 'png', encoding: 'base64-dataurl' });
                    }
                });
            });
        }
    },
    {
        name: 'get_tab_info',
        description: 'Get basic information about the current active tab (ID, URL, title)',
        icon: '🌐',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        execute: async () => {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'GET_TAB_INFO' }, (response) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response);
                    }
                });
            });
        }
    }
];

/**
 * Get all browser tools
 * @returns {Array} Tool definitions
 */
function getBrowserTools() {
    return BROWSER_TOOLS;
}

/**
 * Execute a browser tool by name
 * @param {string} name - Tool name
 * @param {object} params - Tool parameters
 * @returns {object} Tool result
 */
async function executeBrowserTool(name, params = {}) {
    const tool = BROWSER_TOOLS.find(t => t.name === name);
    if (!tool) {
        throw new Error(`Unknown browser tool: ${name}`);
    }
    return await tool.execute(params);
}

/**
 * Format tools for inclusion in AI chat messages
 * @param {Array} tools - Tool definitions
 * @returns {string} Formatted tool descriptions
 */
function formatToolsForContext(tools) {
    return tools.map(t =>
        `- **${t.name}**: ${t.description}`
    ).join('\n');
}

/**
 * Convert tools to OpenAI function calling format
 * @param {Array} tools - Tool definitions
 * @returns {Array} OpenAI-compatible tool definitions
 */
function toOpenAIFunctions(tools) {
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: 'object', properties: {} }
        }
    }));
}

window.BrowserTools = {
    getAll: getBrowserTools,
    execute: executeBrowserTool,
    formatForContext: formatToolsForContext,
    toOpenAIFunctions: toOpenAIFunctions,
    list: BROWSER_TOOLS
};
