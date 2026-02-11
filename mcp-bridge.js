#!/usr/bin/env node

/**
 * MCP Bridge Server
 * 
 * Bridges STDIO-based MCP servers to HTTP endpoints so the browser extension can use them.
 * 
 * Usage:
 *   node mcp-bridge.js                    # Uses mcp-config.json
 *   node mcp-bridge.js --port 3100        # Custom port
 *   node mcp-bridge.js --config my.json   # Custom config file
 * 
 * Config format (mcp-config.json):
 * {
 *   "mcpServers": {
 *     "browsermcp": {
 *       "command": "npx",
 *       "args": ["@browsermcp/mcp@latest"]
 *     }
 *   }
 * }
 * 
 * The bridge exposes:
 *   GET  /                     → Server status & connected MCP servers
 *   GET  /servers              → List all MCP servers and their tools
 *   POST /servers/:name/tools  → List tools for a specific server
 *   POST /servers/:name/call   → Call a tool on a specific server
 *   GET  /sse                  → SSE endpoint (for MCP client compatibility)
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ===== Config =====
const args = process.argv.slice(2);
let PORT = 3100;
let CONFIG_FILE = 'mcp-config.json';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) PORT = parseInt(args[i + 1]);
    if (args[i] === '--config' && args[i + 1]) CONFIG_FILE = args[i + 1];
}

// ===== MCP Server Manager =====
class MCPServerProcess {
    constructor(name, config) {
        this.name = name;
        this.config = config;
        this.process = null;
        this.tools = [];
        this.ready = false;
        this.pendingRequests = new Map();
        this.nextId = 1;
        this.buffer = '';
    }

    async start() {
        return new Promise((resolve, reject) => {
            const { command, args: cmdArgs = [], env: extraEnv = {} } = this.config;

            console.log(`[${this.name}] Starting: ${command} ${cmdArgs.join(' ')}`);

            this.process = spawn(command, cmdArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, ...extraEnv },
                shell: true
            });

            this.process.stdout.on('data', (data) => {
                this.buffer += data.toString();
                this._processBuffer();
            });

            this.process.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) console.log(`[${this.name}] stderr: ${msg}`);
            });

            this.process.on('error', (err) => {
                console.error(`[${this.name}] Process error:`, err.message);
                reject(err);
            });

            this.process.on('close', (code) => {
                console.log(`[${this.name}] Process exited with code ${code}`);
                this.ready = false;
            });

            // Initialize the MCP session
            setTimeout(async () => {
                try {
                    // Send initialize request
                    await this._sendRequest('initialize', {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        clientInfo: { name: 'mcp-bridge', version: '1.0.0' }
                    });

                    // Send initialized notification
                    this._sendNotification('notifications/initialized', {});

                    // List tools
                    const toolsResult = await this._sendRequest('tools/list', {});
                    this.tools = toolsResult.tools || [];
                    this.ready = true;

                    console.log(`[${this.name}] Ready with ${this.tools.length} tools: ${this.tools.map(t => t.name).join(', ')}`);
                    resolve();
                } catch (err) {
                    console.error(`[${this.name}] Init failed:`, err.message);
                    reject(err);
                }
            }, 1000);
        });
    }

    _processBuffer() {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const msg = JSON.parse(trimmed);

                if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                    const { resolve, reject } = this.pendingRequests.get(msg.id);
                    this.pendingRequests.delete(msg.id);

                    if (msg.error) {
                        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        resolve(msg.result);
                    }
                }
            } catch (e) {
                // Skip non-JSON lines
            }
        }
    }

    _sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pendingRequests.set(id, { resolve, reject });

            const message = JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params
            }) + '\n';

            this.process.stdin.write(message);

            // Timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout: ${method}`));
                }
            }, 30000);
        });
    }

    _sendNotification(method, params) {
        const message = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params
        }) + '\n';

        this.process.stdin.write(message);
    }

    async callTool(toolName, args = {}) {
        if (!this.ready) throw new Error(`Server "${this.name}" is not ready`);

        const result = await this._sendRequest('tools/call', {
            name: toolName,
            arguments: args
        });

        return result;
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.ready = false;
        }
    }
}

// ===== HTTP Server =====
const servers = {};

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                resolve({});
            }
        });
    });
}

const httpServer = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    try {
        // GET / — Status
        if (pathname === '/' && req.method === 'GET') {
            const serverList = Object.entries(servers).map(([name, srv]) => ({
                name,
                ready: srv.ready,
                toolCount: srv.tools.length,
                tools: srv.tools.map(t => t.name)
            }));

            sendJSON(res, 200, {
                status: 'running',
                bridge: 'MCP Bridge Server',
                version: '1.0.0',
                port: PORT,
                servers: serverList
            });
            return;
        }

        // GET /servers — List all servers and tools
        if (pathname === '/servers' && req.method === 'GET') {
            const result = {};
            for (const [name, srv] of Object.entries(servers)) {
                result[name] = {
                    ready: srv.ready,
                    tools: srv.tools
                };
            }
            sendJSON(res, 200, result);
            return;
        }

        // POST /servers/:name/tools — List tools for a server
        const toolsMatch = pathname.match(/^\/servers\/([^/]+)\/tools$/);
        if (toolsMatch && req.method === 'POST') {
            const serverName = decodeURIComponent(toolsMatch[1]);
            const srv = servers[serverName];
            if (!srv) {
                sendJSON(res, 404, { error: `Server "${serverName}" not found` });
                return;
            }
            sendJSON(res, 200, { tools: srv.tools });
            return;
        }

        // POST /servers/:name/call — Call a tool
        const callMatch = pathname.match(/^\/servers\/([^/]+)\/call$/);
        if (callMatch && req.method === 'POST') {
            const serverName = decodeURIComponent(callMatch[1]);
            const srv = servers[serverName];
            if (!srv) {
                sendJSON(res, 404, { error: `Server "${serverName}" not found` });
                return;
            }

            const body = await readBody(req);
            const { tool, arguments: toolArgs = {} } = body;

            if (!tool) {
                sendJSON(res, 400, { error: 'Missing "tool" in request body' });
                return;
            }

            const result = await srv.callTool(tool, toolArgs);
            sendJSON(res, 200, { result });
            return;
        }

        // GET /sse — SSE endpoint for MCP client compatibility
        if (pathname === '/sse' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            // Send initial connection event
            res.write(`data: ${JSON.stringify({ type: 'connected', servers: Object.keys(servers) })}\n\n`);

            // Keep alive
            const interval = setInterval(() => {
                res.write(': keepalive\n\n');
            }, 15000);

            req.on('close', () => clearInterval(interval));
            return;
        }

        // POST /message — JSON-RPC endpoint for MCP client compatibility
        if (pathname === '/message' && req.method === 'POST') {
            const body = await readBody(req);
            const { method, params, id } = body;

            if (method === 'tools/list') {
                // Aggregate tools from all servers
                const allTools = [];
                for (const [name, srv] of Object.entries(servers)) {
                    for (const tool of srv.tools) {
                        allTools.push({
                            ...tool,
                            name: `${name}__${tool.name}`, // namespace with server name
                            _serverName: name,
                            _originalName: tool.name
                        });
                    }
                }
                sendJSON(res, 200, { jsonrpc: '2.0', id, result: { tools: allTools } });
                return;
            }

            if (method === 'tools/call') {
                const toolName = params?.name || '';
                const toolArgs = params?.arguments || {};

                // Check if namespaced (serverName__toolName)
                let serverName, actualToolName;
                if (toolName.includes('__')) {
                    [serverName, actualToolName] = toolName.split('__', 2);
                } else {
                    // Find tool across all servers
                    for (const [name, srv] of Object.entries(servers)) {
                        if (srv.tools.some(t => t.name === toolName)) {
                            serverName = name;
                            actualToolName = toolName;
                            break;
                        }
                    }
                }

                if (!serverName || !servers[serverName]) {
                    sendJSON(res, 404, { jsonrpc: '2.0', id, error: { code: -32601, message: `Tool "${toolName}" not found` } });
                    return;
                }

                const result = await servers[serverName].callTool(actualToolName, toolArgs);
                sendJSON(res, 200, { jsonrpc: '2.0', id, result });
                return;
            }

            sendJSON(res, 400, { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
            return;
        }

        // 404
        sendJSON(res, 404, { error: 'Not found' });

    } catch (err) {
        console.error('Request error:', err);
        sendJSON(res, 500, { error: err.message });
    }
});

// ===== Startup =====
async function main() {
    // Load config
    const configPath = path.resolve(CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
        console.log(`Config file not found: ${configPath}`);
        console.log('Creating default mcp-config.json...');

        const defaultConfig = {
            mcpServers: {
                browsermcp: {
                    command: 'npx',
                    args: ['-y', '@anthropic-ai/mcp-server-demo@latest']
                }
            }
        };

        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log(`Created ${configPath} — edit it with your MCP servers, then restart.`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
        console.error('No MCP servers configured in', configPath);
        process.exit(1);
    }

    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║         MCP Bridge Server v1.0.0         ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Start each MCP server process
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        try {
            const srv = new MCPServerProcess(name, serverConfig);
            servers[name] = srv;
            await srv.start();
        } catch (err) {
            console.error(`[${name}] Failed to start:`, err.message);
        }
    }

    // Start HTTP server
    httpServer.listen(PORT, () => {
        console.log('');
        console.log(`🌐 Bridge running at http://localhost:${PORT}`);
        console.log('');
        console.log('Extension config (paste in Settings → MCP Servers):');
        console.log('─'.repeat(45));
        console.log(JSON.stringify({
            mcpServers: {
                bridge: {
                    url: `http://localhost:${PORT}/sse`,
                    transport: 'sse'
                }
            }
        }, null, 2));
        console.log('─'.repeat(45));
        console.log('');
        console.log('Press Ctrl+C to stop.');
    });
}

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    Object.values(servers).forEach(srv => srv.stop());
    httpServer.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    Object.values(servers).forEach(srv => srv.stop());
    httpServer.close();
    process.exit(0);
});

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
