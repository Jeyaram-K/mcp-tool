// CDP Tools - Built-in Chrome DevTools Protocol browser control tools
// Uses chrome.debugger API directly — no external relay or gateway needed
// Optimized for AI-driven browser automation with selector-based interactions

const CDP_TOOLS = [
    {
        name: 'cdp_attach_tab',
        description: 'Attach the Chrome Debugger to the active tab. Only needed for cdp_screenshot and cdp_execute. Other tools work without attaching.',
        icon: '🔗',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: {
                    type: 'number',
                    description: 'Optional tab ID to attach to. If omitted, uses the current active tab.'
                }
            },
            required: []
        },
        execute: async (params) => {
            return _cdpMessage({ type: 'CDP_ATTACH', tabId: params.tabId });
        }
    },
    {
        name: 'cdp_detach_tab',
        description: 'Detach the Chrome Debugger from a tab',
        icon: '🔓',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID to detach. If omitted, detaches the current active tab.' }
            },
            required: []
        },
        execute: async (params) => {
            return _cdpMessage({ type: 'CDP_DETACH', tabId: params.tabId });
        }
    },
    {
        name: 'cdp_list_attached',
        description: 'List all tabs currently attached to the Chrome Debugger with their URLs and titles',
        icon: '📋',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: async () => {
            return _cdpMessage({ type: 'CDP_LIST_ATTACHED' });
        }
    },
    {
        name: 'cdp_navigate',
        description: 'Navigate a tab to a URL and wait for the page to load. No debugger attachment needed.',
        icon: '🧭',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to navigate to' },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['url']
        },
        execute: async (args) => {
            const result = await _cdpMessage({
                type: 'CDP_NAVIGATE',
                url: args.url,
                tabId: args.tabId
            });
            return result;
        }
    },
    {
        name: 'cdp_get_page_info',
        description: 'Get the current page URL, title, DOM readiness state, and a snapshot of visible text content. Very useful to understand what page you are on.',
        icon: '📄',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_GET_PAGE_INFO', tabId: args.tabId });
        }
    },
    {
        name: 'cdp_get_page_content',
        description: 'Get a clean, structured representation of interactive elements on the page (buttons, links, inputs, headings) along with their CSS selectors. USE THIS FIRST when you need to know what to interact with on a new page.',
        icon: '👁️',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_GET_PAGE_CONTENT', tabId: args.tabId });
        }
    },
    {
        name: 'cdp_screenshot',
        description: 'Take a screenshot of the current page. Returns a base64-encoded PNG image.',
        icon: '📸',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' },
                fullPage: { type: 'boolean', description: 'Capture full scrollable page (default: false, viewport only)' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_SCREENSHOT', tabId: args.tabId, fullPage: args.fullPage });
        }
    },
    {
        name: 'cdp_query_elements',
        description: 'Find elements on the page by CSS selector. Returns a list of matching elements with their tag, text, attributes (id, class, href, type, value, placeholder, name, aria-label, role), and bounding box coordinates. Use this to discover what to click or interact with.',
        icon: '🔍',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector to query, e.g. "button", "a[href]", "#login-form input", ".nav-item", "input[type=text]"'
                },
                limit: {
                    type: 'number',
                    description: 'Max number of elements to return (default: 20)'
                },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_QUERY_ELEMENTS',
                selector: args.selector,
                limit: args.limit || 20,
                tabId: args.tabId
            });
        }
    },
    {
        name: 'cdp_click_element',
        description: 'Click an element on the page by CSS selector. Scrolls the element into view and clicks its center. If multiple elements match, clicks the first one (or specify an index).',
        icon: '🖱️',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of the element to click, e.g. "button.submit", "#login-btn", "a[href=\'/about\']"'
                },
                index: {
                    type: 'number',
                    description: 'If multiple elements match, click this index (0-based, default: 0)'
                },
                rawCDP: {
                    type: 'boolean',
                    description: 'If true, uses true hardware-level mouse events (CDP Input API) instead of JS events. Use this if standard clicking fails (e.g., highly protected forms). Requires tab to be focused/visible.'
                },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_CLICK_ELEMENT',
                selector: args.selector,
                index: args.index || 0,
                rawCDP: args.rawCDP || false,
                tabId: args.tabId
            });
        }
    },
    {
        name: 'cdp_fill_input',
        description: 'Fill an input field or textarea by CSS selector. Clears the existing value first, then types the new value. Handles text inputs, password fields, textareas, etc.',
        icon: '✏️',
        inputSchema: {
            type: 'object',
            properties: {
                selector: {
                    type: 'string',
                    description: 'CSS selector of the input/textarea, e.g. "#username", "input[name=email]", ".search-box"'
                },
                value: {
                    type: 'string',
                    description: 'Text value to fill in'
                },
                index: {
                    type: 'number',
                    description: 'If multiple elements match, fill this index (0-based, default: 0)'
                },
                rawCDP: {
                    type: 'boolean',
                    description: 'If true, uses true hardware-level keyboard events (CDP Input API). Use if JS filling fails.'
                },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['selector', 'value']
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_FILL_INPUT',
                selector: args.selector,
                value: args.value,
                index: args.index || 0,
                rawCDP: args.rawCDP || false,
                tabId: args.tabId
            });
        }
    },
    {
        name: 'cdp_evaluate',
        description: 'Evaluate a JavaScript expression on the page and return the result. Useful for complex interactions, reading values, or custom automation logic.',
        icon: '📜',
        inputSchema: {
            type: 'object',
            properties: {
                expression: { type: 'string', description: 'JavaScript expression to evaluate in the page context' },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['expression']
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_EXECUTE',
                method: 'Runtime.evaluate',
                params: { expression: args.expression, returnByValue: true, awaitPromise: true },
                tabId: args.tabId
            });
        }
    },
    {
        name: 'cdp_scroll',
        description: 'Scroll the page by a given amount or scroll an element into view',
        icon: '📜',
        inputSchema: {
            type: 'object',
            properties: {
                direction: {
                    type: 'string',
                    description: 'Scroll direction: "up", "down", "top", "bottom"'
                },
                amount: {
                    type: 'number',
                    description: 'Pixels to scroll (default: 500). Ignored for "top"/"bottom".'
                },
                selector: {
                    type: 'string',
                    description: 'Optional: CSS selector of element to scroll into view (overrides direction/amount)'
                },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_SCROLL',
                direction: args.direction || 'down',
                amount: args.amount || 500,
                selector: args.selector,
                tabId: args.tabId
            });
        }
    },
    {
        name: 'cdp_press_key',
        description: 'Press a keyboard key (Enter, Tab, Escape, Backspace, ArrowDown, etc.)',
        icon: '⌨️',
        inputSchema: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Key name: "Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp", "Space", etc.'
                },
                modifiers: {
                    type: 'string',
                    description: 'Optional modifier keys: "ctrl", "shift", "alt", "meta" (comma-separated for combos, e.g. "ctrl,shift")'
                },
                rawCDP: {
                    type: 'boolean',
                    description: 'If true, uses true hardware-level keyboard events.'
                },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['key']
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_PRESS_KEY',
                key: args.key,
                modifiers: args.modifiers,
                rawCDP: args.rawCDP || false,
                tabId: args.tabId
            });
        }
    },
    {
        name: 'cdp_type_text',
        description: 'Type text character by character into the currently focused element. Use cdp_click_element first to focus an input.',
        icon: '⌨️',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to type' },
                rawCDP: {
                    type: 'boolean',
                    description: 'If true, uses hardware-level text insertion. Requires tab focus.'
                },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['text']
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_TYPE_TEXT',
                text: args.text,
                rawCDP: args.rawCDP || false,
                tabId: args.tabId
            });
        }
    },
    // ===== Smart Browsing Tools =====
    {
        name: 'cdp_wait_for',
        description: 'Wait for an element to appear on the page (useful for dynamic/SPA pages). Polls until found or timeout.',
        icon: '⏳',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector to wait for' },
                timeout: { type: 'number', description: 'Max wait time in ms (default: 10000)' },
                visible: { type: 'boolean', description: 'If true, wait until element is also visible (default: false)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_WAIT_FOR', selector: args.selector, timeout: args.timeout, visible: args.visible, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_select_option',
        description: 'Select an option from a <select> dropdown by value or visible text.',
        icon: '📋',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the <select> element' },
                value: { type: 'string', description: 'Option value or text to select' },
                byText: { type: 'boolean', description: 'If true, match by visible text instead of value attribute (default: false)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector', 'value']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_SELECT_OPTION', selector: args.selector, value: args.value, byText: args.byText, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_check',
        description: 'Check or uncheck a checkbox, or select a radio button.',
        icon: '☑️',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the checkbox/radio' },
                checked: { type: 'boolean', description: 'true to check, false to uncheck (default: true)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_CHECK', selector: args.selector, checked: args.checked, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_hover',
        description: 'Hover over an element to trigger dropdown menus, tooltips, or hover effects.',
        icon: '👆',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the element to hover' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_HOVER', selector: args.selector, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_get_text',
        description: 'Get the text content, value, href, or checked state of a specific element.',
        icon: '📖',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the element' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_GET_TEXT', selector: args.selector, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_find_text',
        description: 'Search for text anywhere on the page. Returns matching locations and nearby interactive elements with their selectors.',
        icon: '🔎',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to search for (case-insensitive)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['text']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_FIND_TEXT', text: args.text, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_go_back',
        description: 'Go back in browser history (like pressing the back button).',
        icon: '⬅️',
        inputSchema: {
            type: 'object',
            properties: { tabId: { type: 'number', description: 'Tab ID' } },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_GO_BACK', tabId: args.tabId });
        }
    },
    {
        name: 'cdp_go_forward',
        description: 'Go forward in browser history.',
        icon: '➡️',
        inputSchema: {
            type: 'object',
            properties: { tabId: { type: 'number', description: 'Tab ID' } },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_GO_FORWARD', tabId: args.tabId });
        }
    },
    {
        name: 'cdp_new_tab',
        description: 'Open a new browser tab, optionally with a URL.',
        icon: '➕',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to open in the new tab (default: blank tab)' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_NEW_TAB', url: args.url });
        }
    },
    {
        name: 'cdp_switch_tab',
        description: 'Switch to a different browser tab. Call without tabId to list all open tabs.',
        icon: '🔄',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID to switch to. Omit to list all tabs.' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_SWITCH_TAB', tabId: args.tabId });
        }
    },
    {
        name: 'cdp_close_tab',
        description: 'Close the current or a specific browser tab.',
        icon: '❌',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID to close. Omit to close current tab.' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_CLOSE_TAB', tabId: args.tabId });
        }
    },
    {
        name: 'cdp_handle_dialog',
        description: 'Accept or dismiss a browser dialog (alert, confirm, prompt).',
        icon: '💬',
        inputSchema: {
            type: 'object',
            properties: {
                accept: { type: 'boolean', description: 'true to accept/OK, false to dismiss/Cancel (default: true)' },
                promptText: { type: 'string', description: 'Text to enter in a prompt dialog' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_HANDLE_DIALOG', accept: args.accept, promptText: args.promptText, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_extract_data',
        description: 'Extract structured data from tables, lists, or any element. Returns data in clean format.',
        icon: '📊',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the table, list, or container element' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_EXTRACT_DATA', selector: args.selector, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_execute',
        description: 'Execute a raw CDP (Chrome DevTools Protocol) command. For advanced users who know CDP methods like DOM.getDocument, Network.enable, etc.',
        icon: '⚡',
        inputSchema: {
            type: 'object',
            properties: {
                method: { type: 'string', description: 'CDP method name, e.g. "DOM.getDocument", "Network.enable"' },
                params: { type: 'object', description: 'CDP method parameters' },
                tabId: { type: 'number', description: 'Tab ID. If omitted, uses the first attached tab.' }
            },
            required: ['method']
        },
        execute: async (args) => {
            return _cdpMessage({
                type: 'CDP_EXECUTE',
                method: args.method,
                params: args.params || {},
                tabId: args.tabId
            });
        }
    },
    // ===== Advanced Capabilities =====
    {
        name: 'cdp_cookies',
        description: 'Manage browser cookies: get all cookies, set a cookie, delete a cookie, or clear all cookies. Useful for login session handling.',
        icon: '🍪',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: '"get", "set", "delete", or "clear"' },
                name: { type: 'string', description: 'Cookie name (for set/delete)' },
                value: { type: 'string', description: 'Cookie value (for set)' },
                domain: { type: 'string', description: 'Cookie domain (for set/delete)' },
                path: { type: 'string', description: 'Cookie path (for set, default: "/")' },
                urls: { type: 'array', description: 'URLs to get cookies for (for get)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['action']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_COOKIES', ...args });
        }
    },
    {
        name: 'cdp_network',
        description: 'Monitor network requests: view recent requests, start/stop request interception.',
        icon: '🌐',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: '"getRequests" to list recent network requests, "intercept" to start intercepting, "stopIntercept" to stop' },
                filter: { type: 'string', description: 'Filter requests by URL substring (for getRequests)' },
                pattern: { type: 'string', description: 'URL pattern to intercept (for intercept, default: "*")' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['action']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_NETWORK', ...args });
        }
    },
    {
        name: 'cdp_file_upload',
        description: 'Upload file(s) to a file input element. Provide the full file path(s).',
        icon: '📁',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the file input element' },
                files: { description: 'File path string or array of file paths to upload' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector', 'files']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_FILE_UPLOAD', ...args });
        }
    },
    {
        name: 'cdp_iframe',
        description: 'Execute JavaScript code inside a same-origin iFrame. Cannot access cross-origin iFrames.',
        icon: '🪟',
        inputSchema: {
            type: 'object',
            properties: {
                iframeSelector: { type: 'string', description: 'CSS selector of the iFrame element' },
                code: { type: 'string', description: 'JavaScript code to execute. Has access to "document" and "window" of the iFrame.' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['iframeSelector', 'code']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_IFRAME', ...args });
        }
    },
    {
        name: 'cdp_highlight',
        description: 'Visually highlight an element on the page with a red outline (for debugging). The highlight fades after a duration.',
        icon: '🔴',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the element to highlight' },
                duration: { type: 'number', description: 'How long to show highlight in ms (default: 2000)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['selector']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_HIGHLIGHT', ...args });
        }
    },
    {
        name: 'cdp_wait_idle',
        description: 'Wait for the page to become idle (no pending network requests, DOM fully loaded). Useful after navigation or AJAX operations.',
        icon: '⏱️',
        inputSchema: {
            type: 'object',
            properties: {
                timeout: { type: 'number', description: 'Max wait time in ms (default: 10000)' },
                idleTime: { type: 'number', description: 'How long network must be idle in ms (default: 500)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_WAIT_IDLE', ...args });
        }
    },
    {
        name: 'cdp_console',
        description: 'Capture and read browser console logs (log, warn, error, info + uncaught errors). First call injects the capture hooks, subsequent calls return captured logs.',
        icon: '🖥️',
        inputSchema: {
            type: 'object',
            properties: {
                maxEntries: { type: 'number', description: 'Max number of log entries to return (default: 50)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_CONSOLE', ...args });
        }
    },
    {
        name: 'cdp_drag_drop',
        description: 'Drag an element and drop it onto another element. Uses HTML5 drag events.',
        icon: '🔀',
        inputSchema: {
            type: 'object',
            properties: {
                fromSelector: { type: 'string', description: 'CSS selector of the element to drag' },
                toSelector: { type: 'string', description: 'CSS selector of the drop target' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['fromSelector', 'toSelector']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_DRAG_DROP', ...args });
        }
    },
    // ===== Visual Search Tools =====
    {
        name: 'cdp_smart_locate',
        description: 'Find elements using natural language. Search by visible text, ARIA label, placeholder, title, alt text, name, or ID — with fuzzy matching and scoring. Returns the best CSS selector. Use this FIRST when you don\'t know the exact selector.',
        icon: '🎯',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language search, e.g. "login button", "search input", "subscribe", "email field"' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: ['query']
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_SMART_LOCATE', query: args.query, tabId: args.tabId });
        }
    },
    {
        name: 'cdp_annotate_page',
        description: 'Get a visual map of all interactive elements on the page, numbered and grouped by region (top-left, middle-center, bottom-right, etc.). Use this to understand the page layout and pick the right element. Filters: "interactive" (default), "forms", "links", "all".',
        icon: '🗺️',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'string', description: '"interactive" (buttons/links/inputs), "forms" (form elements only), "links" (links only), or "all" (everything including text)' },
                tabId: { type: 'number', description: 'Tab ID' }
            },
            required: []
        },
        execute: async (args) => {
            return _cdpMessage({ type: 'CDP_ANNOTATE_PAGE', filter: args.filter, tabId: args.tabId });
        }
    }
];

// ===== Shared message helper =====
function _cdpMessage(msg) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response?.error) {
                reject(new Error(response.error));
            } else {
                resolve(response.data);
            }
        });
    });
}

/**
 * Get all CDP tools
 */
function getCDPTools() {
    return CDP_TOOLS;
}

/**
 * Execute a CDP tool by name
 */
async function executeCDPTool(name, params = {}) {
    const tool = CDP_TOOLS.find(t => t.name === name);
    if (!tool) {
        throw new Error(`Unknown CDP tool: ${name}`);
    }
    return await tool.execute(params);
}

window.CDPTools = {
    getAll: getCDPTools,
    execute: executeCDPTool,
    list: CDP_TOOLS
};
