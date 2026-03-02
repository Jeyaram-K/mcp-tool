// AI Memory - Reinforcement Learning Module
// Stores successful action patterns per domain so the AI doesn't repeat mistakes.
// Learns from: tool successes, error→fix pairs, site-specific selectors, and action sequences.

const AIMemory = (() => {
    const STORAGE_KEY = 'ai_memory_patterns';
    const MAX_PATTERNS_PER_DOMAIN = 30;
    const MAX_DOMAINS = 50;

    // ===== Common site knowledge (built-in, never deleted) =====
    const BUILT_IN_KNOWLEDGE = {
        'youtube.com': {
            selectors: {
                'search box': 'input#search',
                'search button': 'button#search-icon-legacy',
                'first video': 'ytd-video-renderer a#video-title',
                'play button': '.ytp-play-button',
                'video player': 'video.html5-main-video',
                'subscribe button': '#subscribe-button button',
                'like button': 'like-button-view-model button',
                'share button': 'button[aria-label="Share"]',
                'channel name': '#channel-name a',
                'video title': 'h1.ytd-watch-metadata'
            },
            tips: [
                'Search: fill input#search, then press Enter or click button#search-icon-legacy',
                'Play video: click a#video-title on any ytd-video-renderer',
                'Videos auto-play after navigation — no need to click play',
                'Use cdp_fill_input for search box, not cdp_type_text'
            ]
        },
        'google.com': {
            selectors: {
                'search box': 'textarea[name="q"], input[name="q"]',
                'search button': 'input[name="btnK"]',
                'first result': '#search .g a',
                'lucky button': 'input[name="btnI"]',
                'images tab': 'a[data-hveid]:has(div:contains("Images"))'
            },
            tips: [
                'Search: fill textarea[name="q"] then press Enter',
                'Results are in #search .g containers, links are the first <a> in each',
                'To get search results, use cdp_get_page_content after searching'
            ]
        },
        'amazon.com': {
            selectors: {
                'search box': 'input#twotabsearchtextbox',
                'search button': 'input#nav-search-submit-button',
                'first product': '[data-component-type="s-search-result"] h2 a',
                'add to cart': '#add-to-cart-button',
                'price': '.a-price .a-offscreen'
            },
            tips: [
                'Search: fill #twotabsearchtextbox then press Enter',
                'Product results have data-component-type="s-search-result"',
                'Prices are in .a-price .a-offscreen (use cdp_get_text)'
            ]
        },
        'github.com': {
            selectors: {
                'search box': 'input.header-search-input, input[name="query-builder-test"]',
                'repo link': 'a[data-testid="listitem-title-link"]',
                'code tab': '#code-tab',
                'issues tab': '#issues-tab',
                'file content': '.react-code-lines'
            },
            tips: [
                'Search: click the search input in the header, type query, press Enter',
                'Repository results are links with data-testid="listitem-title-link"'
            ]
        }
    };

    // ===== Storage =====  
    function loadMemory() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    function saveMemory(memory) {
        try {
            // Trim if too large
            const domains = Object.keys(memory);
            if (domains.length > MAX_DOMAINS) {
                // Remove oldest domains
                const sorted = domains.sort((a, b) => {
                    const aTime = memory[a]._lastUsed || 0;
                    const bTime = memory[b]._lastUsed || 0;
                    return aTime - bTime;
                });
                for (let i = 0; i < sorted.length - MAX_DOMAINS; i++) {
                    delete memory[sorted[i]];
                }
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
        } catch { /* storage full - clear old entries */ }
    }

    function getDomain(url) {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch { return 'unknown'; }
    }

    /**
     * Record a successful action pattern.
     * Called ONLY after a tool call is verified as genuinely successful.
     */
    function learnSuccess(domain, toolName, args, result) {
        // Double-check: never learn from error results
        if (!result || result.error || result.verified === false) return;
        if (typeof result === 'string' && result.toLowerCase().includes('error')) return;

        const memory = loadMemory();
        if (!memory[domain]) memory[domain] = { patterns: [], selectors: {}, errorFixes: [], _lastUsed: Date.now() };
        memory[domain]._lastUsed = Date.now();

        // Learn selector → element mapping from cdp_smart_locate
        if (toolName === 'cdp_smart_locate' && args.query && result.bestSelector) {
            memory[domain].selectors[args.query] = result.bestSelector;
        }

        // Remember which selectors worked for which actions
        if (args.selector && (toolName === 'cdp_click_element' || toolName === 'cdp_fill_input')) {
            // Only learn if action confirmed success (clicked:true, filled:true, etc.)
            if (result.clicked || result.filled || result.typed || result.pressed) {
                const key = `${toolName}:${args.selector}`;
                const existing = memory[domain].patterns.find(p => p.key === key);
                if (existing) {
                    existing.successCount = (existing.successCount || 1) + 1;
                    existing.lastUsed = Date.now();
                } else {
                    memory[domain].patterns.push({
                        key,
                        tool: toolName,
                        selector: args.selector,
                        successCount: 1,
                        lastUsed: Date.now()
                    });
                }
            }
        }

        // Trim oldest patterns
        if (memory[domain].patterns.length > MAX_PATTERNS_PER_DOMAIN) {
            memory[domain].patterns.sort((a, b) => b.successCount - a.successCount);
            memory[domain].patterns = memory[domain].patterns.slice(0, MAX_PATTERNS_PER_DOMAIN);
        }

        saveMemory(memory);
    }

    /**
     * Record an error→fix pair.
     * Called when an action fails but a retry with different approach succeeds.
     */
    function learnErrorFix(domain, toolName, errorMsg, fixAction) {
        const memory = loadMemory();
        if (!memory[domain]) memory[domain] = { patterns: [], selectors: {}, errorFixes: [], _lastUsed: Date.now() };
        memory[domain]._lastUsed = Date.now();

        // Don't duplicate
        const existing = memory[domain].errorFixes.find(f =>
            f.tool === toolName && f.error === errorMsg
        );
        if (!existing) {
            memory[domain].errorFixes.push({
                tool: toolName,
                error: errorMsg,
                fix: fixAction,
                learnedAt: Date.now()
            });
        }

        // Keep max 20 error fixes per domain
        if (memory[domain].errorFixes.length > 20) {
            memory[domain].errorFixes = memory[domain].errorFixes.slice(-20);
        }

        saveMemory(memory);
    }

    /**
     * Learn from a complete action sequence.
     * Only saves if >= 70% of steps succeeded — don't memorize broken workflows.
     */
    function learnSequence(domain, taskDescription, toolCalls) {
        // Filter to only successful steps
        const successfulSteps = toolCalls.filter(tc => tc.success && !tc.error);
        const totalSteps = toolCalls.length;

        // Don't learn if too few steps succeeded (< 70%)
        if (totalSteps === 0 || (successfulSteps.length / totalSteps) < 0.7) return;

        const memory = loadMemory();
        if (!memory[domain]) memory[domain] = { patterns: [], selectors: {}, errorFixes: [], sequences: [], _lastUsed: Date.now() };
        memory[domain]._lastUsed = Date.now();

        if (!memory[domain].sequences) memory[domain].sequences = [];

        const steps = successfulSteps.map(tc => ({
            tool: tc.name,
            args: tc.args
        }));

        if (steps.length > 0) {
            const existing = memory[domain].sequences.find(s =>
                s.task.toLowerCase() === taskDescription.toLowerCase()
            );
            if (existing) {
                existing.steps = steps;
                existing.usedCount = (existing.usedCount || 1) + 1;
                existing.lastUsed = Date.now();
            } else {
                memory[domain].sequences.push({
                    task: taskDescription,
                    steps,
                    usedCount: 1,
                    lastUsed: Date.now()
                });
            }

            if (memory[domain].sequences.length > 10) {
                memory[domain].sequences.sort((a, b) => b.usedCount - a.usedCount);
                memory[domain].sequences = memory[domain].sequences.slice(0, 10);
            }
        }

        saveMemory(memory);
    }

    /**
     * Get all relevant knowledge for a domain — built-in + learned.
     * This is injected into the system prompt before each AI call.
     */
    function getKnowledge(url) {
        const domain = getDomain(url);
        const memory = loadMemory();
        const learned = memory[domain] || {};
        const builtIn = BUILT_IN_KNOWLEDGE[domain] || {};

        let knowledge = '';

        // Built-in selectors
        if (builtIn.selectors) {
            const selectorLines = Object.entries(builtIn.selectors)
                .map(([name, sel]) => `  "${name}" → ${sel}`)
                .join('\n');
            knowledge += `\nKNOWN SELECTORS for ${domain}:\n${selectorLines}\n`;
        }

        // Built-in tips
        if (builtIn.tips && builtIn.tips.length > 0) {
            knowledge += `\nTIPS for ${domain}:\n${builtIn.tips.map(t => `  - ${t}`).join('\n')}\n`;
        }

        // Learned selectors
        if (learned.selectors && Object.keys(learned.selectors).length > 0) {
            const learnedLines = Object.entries(learned.selectors)
                .map(([query, sel]) => `  "${query}" → ${sel}`)
                .join('\n');
            knowledge += `\nLEARNED SELECTORS for ${domain}:\n${learnedLines}\n`;
        }

        // Learned error fixes
        if (learned.errorFixes && learned.errorFixes.length > 0) {
            const fixLines = learned.errorFixes
                .slice(-5) // Show last 5
                .map(f => `  ${f.tool} error "${f.error}" → fix: ${f.fix}`)
                .join('\n');
            knowledge += `\nLEARNED FIXES for ${domain}:\n${fixLines}\n`;
        }

        // Learned sequences
        if (learned.sequences && learned.sequences.length > 0) {
            const seqLines = learned.sequences
                .slice(0, 5)
                .map(s => {
                    const stepStr = s.steps.map(st => `${st.tool}(${JSON.stringify(st.args)})`).join(' → ');
                    return `  "${s.task}" (used ${s.usedCount}x): ${stepStr}`;
                })
                .join('\n');
            knowledge += `\nLEARNED SEQUENCES for ${domain}:\n${seqLines}\n`;
        }

        return knowledge;
    }

    /**
     * Get the current tab's URL for domain matching
     */
    async function getCurrentDomain() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'CDP_GET_PAGE_INFO' }, (response) => {
                if (response && response.data && response.data.url) {
                    resolve(getDomain(response.data.url));
                } else {
                    resolve('unknown');
                }
            });
        });
    }

    /**
     * Clear all learned memory (keep built-in)
     */
    function clearMemory() {
        localStorage.removeItem(STORAGE_KEY);
    }

    /**
     * Get stats about the memory
     */
    function getStats() {
        const memory = loadMemory();
        const domains = Object.keys(memory);
        let totalPatterns = 0;
        let totalFixes = 0;
        let totalSequences = 0;

        domains.forEach(d => {
            totalPatterns += (memory[d].patterns || []).length;
            totalFixes += (memory[d].errorFixes || []).length;
            totalSequences += (memory[d].sequences || []).length;
        });

        return {
            domains: domains.length,
            builtInDomains: Object.keys(BUILT_IN_KNOWLEDGE).length,
            totalPatterns,
            totalFixes,
            totalSequences
        };
    }

    return {
        learnSuccess,
        learnErrorFix,
        learnSequence,
        getKnowledge,
        getCurrentDomain,
        getDomain,
        clearMemory,
        getStats,
        BUILT_IN_KNOWLEDGE
    };
})();
