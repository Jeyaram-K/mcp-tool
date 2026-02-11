// MCP Client - Connect to MCP Bridge Server and external MCP servers

class MCPClient {
    constructor() {
        this.servers = {};
        this.connections = {};
        this.tools = [];
    }

    /**
     * Load server config from settings
     * @param {object} config - MCP server config JSON
     */
    loadConfig(config) {
        if (config && config.mcpServers) {
            this.servers = config.mcpServers;
        }
    }

    /**
     * Connect to all configured MCP servers
     */
    async connectAll() {
        this.tools = [];
        const serverNames = Object.keys(this.servers);

        for (const name of serverNames) {
            try {
                await this.connect(name, this.servers[name]);
            } catch (e) {
                console.error(`Failed to connect to MCP server "${name}":`, e);
            }
        }

        return this.tools;
    }

    /**
     * Connect to a single MCP server
     * @param {string} name - Server name
     * @param {object} serverConfig - Server configuration
     */
    async connect(name, serverConfig) {
        const url = serverConfig.url;

        // Skip command-based configs — those are for the bridge, not the extension
        if (!url && (serverConfig.command || serverConfig.args)) {
            console.warn(`MCP server "${name}" uses command-based config. Run "node mcp-bridge.js" and configure the bridge URL instead.`);
            throw new Error(`Server "${name}" uses command/args config. Use the MCP Bridge: set url to "http://localhost:3100/sse" with transport "sse".`);
        }

        if (!url) {
            throw new Error(`No URL configured for MCP server "${name}"`);
        }

        const transport = serverConfig.transport || 'sse';

        if (transport === 'sse') {
            await this.connectSSE(name, url);
        } else if (transport === 'websocket' || transport === 'ws') {
            await this.connectWebSocket(name, url);
        } else {
            throw new Error(`Unsupported transport "${transport}". Use "sse" or "websocket".`);
        }
    }

    /**
     * Connect via SSE transport (works with MCP Bridge)
     */
    async connectSSE(name, url) {
        try {
            // Determine base URL (strip /sse suffix if present)
            const baseUrl = url.replace(/\/sse\/?$/, '');

            // First try: check if it's our MCP Bridge (has /servers endpoint)
            let isBridge = false;
            try {
                const statusResp = await fetch(baseUrl + '/', { method: 'GET' });
                if (statusResp.ok) {
                    const statusData = await statusResp.json();
                    if (statusData.bridge === 'MCP Bridge Server') {
                        isBridge = true;
                    }
                }
            } catch (e) {
                // Not a bridge, try standard SSE
            }

            if (isBridge) {
                // Use Bridge REST API — much more reliable
                await this.connectBridge(name, baseUrl);
            } else {
                // Standard SSE + JSON-RPC /message endpoint
                await this.connectStandardSSE(name, url);
            }

        } catch (e) {
            this.connections[name] = { type: 'sse', url, status: 'error', error: e.message };
            throw e;
        }
    }

    /**
     * Connect to MCP Bridge Server via REST API
     */
    async connectBridge(name, baseUrl) {
        // List all servers and their tools from bridge
        const response = await fetch(baseUrl + '/servers', { method: 'GET' });

        if (!response.ok) {
            throw new Error(`Bridge connection failed: ${response.status}`);
        }

        const serversData = await response.json();

        for (const [serverName, serverInfo] of Object.entries(serversData)) {
            if (!serverInfo.ready) continue;

            for (const tool of serverInfo.tools) {
                this.tools.push({
                    name: tool.name,
                    description: tool.description || '',
                    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                    serverName: serverName,
                    serverUrl: baseUrl,
                    icon: '🔌',
                    source: 'bridge',
                    execute: async (params) => this.executeToolBridge(baseUrl, serverName, tool.name, params)
                });
            }
        }

        this.connections[name] = { type: 'bridge', url: baseUrl, status: 'connected' };
        console.log(`Connected to MCP Bridge at ${baseUrl}`);
    }

    /**
     * Connect via standard SSE (non-bridge MCP servers)
     */
    async connectStandardSSE(name, url) {
        // Initialize SSE session
        const initResponse = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' }
        });

        if (!initResponse.ok) {
            throw new Error(`SSE connection failed: ${initResponse.status}`);
        }

        // Try to list tools via JSON-RPC
        const messageUrl = url.replace(/\/sse$/, '') + '/message';

        const listToolsResponse = await fetch(messageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {}
            })
        });

        if (listToolsResponse.ok) {
            const result = await listToolsResponse.json();
            if (result.result?.tools) {
                const serverTools = result.result.tools.map(tool => ({
                    ...tool,
                    serverName: name,
                    serverUrl: url,
                    icon: '🔌',
                    source: 'sse',
                    execute: async (params) => this.executeToolSSE(url, tool.name, params)
                }));
                this.tools.push(...serverTools);
            }
        }

        this.connections[name] = { type: 'sse', url, status: 'connected' };
        console.log(`Connected to MCP server "${name}" via SSE`);
    }

    /**
     * Connect via WebSocket transport
     */
    async connectWebSocket(name, url) {
        return new Promise((resolve, reject) => {
            try {
                const ws = new WebSocket(url);

                ws.onopen = () => {
                    this.connections[name] = { type: 'websocket', url, ws, status: 'connected' };
                    ws.send(JSON.stringify({
                        jsonrpc: '2.0', id: 1,
                        method: 'tools/list', params: {}
                    }));
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.id === 1 && data.result?.tools) {
                            const serverTools = data.result.tools.map(tool => ({
                                ...tool,
                                serverName: name,
                                serverUrl: url,
                                icon: '🔌',
                                source: 'websocket',
                                execute: async (params) => this.executeToolWS(name, tool.name, params)
                            }));
                            this.tools.push(...serverTools);
                        }
                        resolve();
                    } catch (e) {
                        console.error('Failed to parse WS message:', e);
                    }
                };

                ws.onerror = () => {
                    this.connections[name] = { type: 'websocket', url, status: 'error', error: 'WebSocket error' };
                    reject(new Error('WebSocket connection failed'));
                };

                ws.onclose = () => {
                    this.connections[name] = { ...this.connections[name], status: 'disconnected' };
                };

                setTimeout(() => {
                    if (ws.readyState !== WebSocket.OPEN) {
                        ws.close();
                        reject(new Error('WebSocket connection timeout'));
                    }
                }, 5000);
            } catch (e) {
                reject(e);
            }
        });
    }

    // ===== Tool Execution Methods =====

    /**
     * Execute tool via MCP Bridge REST API
     */
    async executeToolBridge(baseUrl, serverName, toolName, params = {}) {
        const response = await fetch(`${baseUrl}/servers/${encodeURIComponent(serverName)}/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tool: toolName,
                arguments: params
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Tool execution failed: ${response.status}`);
        }

        const data = await response.json();
        return data.result;
    }

    /**
     * Execute tool via SSE/HTTP JSON-RPC
     */
    async executeToolSSE(serverUrl, toolName, params = {}) {
        const messageUrl = serverUrl.replace(/\/sse$/, '') + '/message';

        const response = await fetch(messageUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: { name: toolName, arguments: params }
            })
        });

        if (!response.ok) {
            throw new Error(`Tool execution failed: ${response.status}`);
        }

        const result = await response.json();
        if (result.error) {
            throw new Error(`Tool error: ${result.error.message}`);
        }

        return result.result;
    }

    /**
     * Execute tool via WebSocket
     */
    async executeToolWS(serverName, toolName, params = {}) {
        const connection = this.connections[serverName];
        if (!connection || !connection.ws || connection.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Not connected to server "${serverName}"`);
        }

        return new Promise((resolve, reject) => {
            const id = Date.now();

            const handler = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.id === id) {
                        connection.ws.removeEventListener('message', handler);
                        if (data.error) {
                            reject(new Error(data.error.message));
                        } else {
                            resolve(data.result);
                        }
                    }
                } catch (e) {
                    reject(e);
                }
            };

            connection.ws.addEventListener('message', handler);
            connection.ws.send(JSON.stringify({
                jsonrpc: '2.0', id,
                method: 'tools/call',
                params: { name: toolName, arguments: params }
            }));

            setTimeout(() => {
                connection.ws.removeEventListener('message', handler);
                reject(new Error('Tool execution timeout'));
            }, 30000);
        });
    }

    // ===== Utility Methods =====

    /** Get all tools from all connected servers */
    getAllTools() {
        return this.tools;
    }

    /** Get connection status for all servers */
    getStatus() {
        return Object.entries(this.connections).map(([name, conn]) => ({
            name,
            type: conn.type,
            url: conn.url,
            status: conn.status,
            error: conn.error
        }));
    }

    /** Format all MCP tools for AI context */
    formatToolsForContext() {
        if (this.tools.length === 0) return '';
        return '\n\nConnected MCP server tools:\n' +
            this.tools.map(t =>
                `- **${t.name}** (${t.serverName}): ${t.description}`
            ).join('\n');
    }

    /** Disconnect all servers */
    disconnectAll() {
        Object.values(this.connections).forEach(conn => {
            if (conn.ws) conn.ws.close();
        });
        this.connections = {};
        this.tools = [];
    }
}

window.MCPClient = MCPClient;
