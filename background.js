// MCP Chat - Background Service Worker
// Opens the side panel when the extension icon is clicked

// ===== CDP Debugger State =====
/** @type {Map<number, {targetId: string}>} */
const cdpAttachedTabs = new Map();

// Use the install event to configure side panel behavior
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));
});

// Also set it on startup (for when extension is already installed)
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set panel behavior:', error));
});

// ===== Helper: resolve tab ID =====
async function resolveTabId(requestedTabId) {
  if (requestedTabId && typeof requestedTabId === 'number') return requestedTabId;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) throw new Error('No active tab found');
  return active.id;
}

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ tabId: tabs[0].id, url: tabs[0].url, title: tabs[0].title });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    });
    return true; // async response
  }

  if (message.type === 'GET_PAGE_CONTENT') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: 'No active tab found' });
        return;
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            return {
              title: document.title,
              url: window.location.href,
              content: document.body.innerText.substring(0, 15000),
              html: document.documentElement.outerHTML.substring(0, 30000),
              meta: {
                description: document.querySelector('meta[name="description"]')?.content || '',
                keywords: document.querySelector('meta[name="keywords"]')?.content || '',
              }
            };
          }
        });
        sendResponse({ data: results[0]?.result });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }

  if (message.type === 'GET_SELECTED_TEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: 'No active tab found' });
        return;
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => window.getSelection()?.toString() || ''
        });
        sendResponse({ data: results[0]?.result });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }

  if (message.type === 'CAPTURE_TAB') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ data: dataUrl });
      }
    });
    return true;
  }

  // ===== CDP: Shared auto-attach helper =====
  async function ensureAttached(requestedTabId) {
    let tabId = requestedTabId;
    if (!tabId) {
      if (cdpAttachedTabs.size > 0) {
        tabId = cdpAttachedTabs.keys().next().value;
      } else {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = active?.id;
      }
    }
    if (!tabId) throw new Error('No tab available');

    if (!cdpAttachedTabs.has(tabId)) {
      await chrome.debugger.attach({ tabId }, '1.3');
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable').catch(() => { });
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable').catch(() => { });
      const info = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo').catch(() => ({}));
      cdpAttachedTabs.set(tabId, { targetId: info?.targetInfo?.targetId || '' });
    }
    return tabId;
  }

  // ===== CDP: Attach debugger to a tab =====
  if (message.type === 'CDP_ATTACH') {
    (async () => {
      try {
        const tabId = await resolveTabId(message.tabId);

        if (cdpAttachedTabs.has(tabId)) {
          const tab = await chrome.tabs.get(tabId);
          sendResponse({ data: { tabId, status: 'already_attached', url: tab.url, title: tab.title } });
          return;
        }

        await chrome.debugger.attach({ tabId }, '1.3');
        await chrome.debugger.sendCommand({ tabId }, 'Page.enable').catch(() => { });
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable').catch(() => { });

        const info = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo');
        const targetId = info?.targetInfo?.targetId || '';
        cdpAttachedTabs.set(tabId, { targetId });

        const tab = await chrome.tabs.get(tabId);
        sendResponse({ data: { tabId, targetId, status: 'attached', url: tab.url, title: tab.title } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Detach debugger from a tab =====
  if (message.type === 'CDP_DETACH') {
    (async () => {
      try {
        const tabId = await resolveTabId(message.tabId);
        if (!cdpAttachedTabs.has(tabId)) {
          sendResponse({ data: { tabId, status: 'not_attached' } });
          return;
        }
        await chrome.debugger.detach({ tabId }).catch(() => { });
        cdpAttachedTabs.delete(tabId);
        sendResponse({ data: { tabId, status: 'detached' } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: List all attached tabs =====
  if (message.type === 'CDP_LIST_ATTACHED') {
    (async () => {
      try {
        const attached = [];
        for (const [tabId, info] of cdpAttachedTabs.entries()) {
          try {
            const tab = await chrome.tabs.get(tabId);
            attached.push({ tabId, targetId: info.targetId, url: tab.url, title: tab.title });
          } catch {
            cdpAttachedTabs.delete(tabId);
          }
        }
        sendResponse({ data: { tabs: attached, count: attached.length } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Helper: get target tab ID =====
  async function getTargetTabId(requestedTabId) {
    if (requestedTabId && typeof requestedTabId === 'number') return requestedTabId;
    if (cdpAttachedTabs.size > 0) return cdpAttachedTabs.keys().next().value;
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active?.id) throw new Error('No tab available');
    return active.id;
  }

  // ===== Helper: Ensure debugger attached =====
  async function ensureAttached(requestedTabId) {
    const tabId = await getTargetTabId(requestedTabId);
    if (!cdpAttachedTabs.has(tabId)) {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
        cdpAttachedTabs.set(tabId, { targetId: '' });
      } catch (err) {
        if (!err.message.includes('Cannot attach to this target')) {
          console.log('[CDP] Auto-attach failed:', err);
        }
      }
    }
    return tabId;
  }

  // ===== Helper: Focus tab (bring to front) for rawCDP =====
  async function focusTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      await new Promise(r => setTimeout(r, 100)); // brief settle
    } catch { /* best effort */ }
  }

  // ===== CDP: Navigate =====
  if (message.type === 'CDP_NAVIGATE') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);

        // Use chrome.tabs.update — most reliable navigation method
        await chrome.tabs.update(tabId, { url: message.url });

        // Wait for page load by polling
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 500));
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => document.readyState
            });
            const state = results?.[0]?.result;
            if (state === 'complete' || state === 'interactive') break;
          } catch {
            // Page not ready yet, keep polling
          }
        }

        const tab = await chrome.tabs.get(tabId);

        // Auto-play video if the page has one (YouTube, etc.)
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const video = document.querySelector('video');
              if (video) {
                video.muted = false;
                video.play().catch(() => { });
              }
              // YouTube-specific: click play button if video is paused
              const playBtn = document.querySelector('.ytp-play-button');
              if (playBtn) playBtn.click();
            }
          });
        } catch { /* video play is best-effort */ }

        sendResponse({ data: { tabId, url: tab.url, title: tab.title, status: 'navigated' } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Get page info =====
  if (message.type === 'CDP_GET_PAGE_INFO') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            bodyText: document.body?.innerText?.substring(0, 5000) || '',
            elementCount: document.querySelectorAll('*').length,
            forms: document.forms.length,
            links: document.links.length,
            inputs: document.querySelectorAll('input, textarea, select').length
          })
        });
        sendResponse({ data: results[0]?.result || {} });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Get structured page content (for AI vision) =====
  if (message.type === 'CDP_GET_PAGE_CONTENT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            function isVisible(el) {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return false;
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }

            function getCssSelector(el) {
              if (el.id) return `#${el.id}`;
              const tag = el.tagName.toLowerCase();
              if (el.className) {
                const classes = Array.from(el.classList).filter(c => !c.match(/hover|active|focus/)).join('.');
                if (classes) return `${tag}.${classes}`;
              }
              if (el.name) return `${tag}[name="${el.name}"]`;
              if (el.type && tag === 'input') return `input[type="${el.type}"]`;
              return tag;
            }

            const elements = [];
            // Target interactive elements and headings
            const selector = 'a, button, input, textarea, select, h1, h2, h3, h4, h5, h6, [role="button"], [role="link"]';
            const nodes = document.querySelectorAll(selector);

            nodes.forEach(el => {
              if (!isVisible(el)) return;

              const tag = el.tagName.toLowerCase();
              const text = (el.innerText || el.textContent || el.value || el.placeholder || el.alt || el.ariaLabel || '').substring(0, 50).trim().replace(/\n/g, ' ');
              if (!text && tag !== 'input' && tag !== 'textarea') return; // Skip empty interactive elements visually

              const item = { tag, text, selector: getCssSelector(el) };
              if (tag === 'input') item.type = el.type;
              if (tag === 'a' && el.href) item.href = el.href.replace(window.location.origin, '');

              elements.push(item);
            });

            return { url: location.href, title: document.title, elements: elements.slice(0, 200) }; // limit to 200 items to avoid token bloat
          }
        });
        sendResponse({ data: results[0]?.result || { url: '', title: '', elements: [] } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Screenshot (uses debugger — the only one that needs it) =====
  if (message.type === 'CDP_SCREENSHOT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        // Ensure debugger is attached for screenshot
        if (!cdpAttachedTabs.has(tabId)) {
          await chrome.debugger.attach({ tabId }, '1.3');
          await chrome.debugger.sendCommand({ tabId }, 'Page.enable').catch(() => { });
          cdpAttachedTabs.set(tabId, { targetId: '' });
        }
        const params = { format: 'png' };
        if (message.fullPage) {
          const metrics = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics');
          const width = Math.ceil(metrics.contentSize.width);
          const height = Math.ceil(metrics.contentSize.height);
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
            width, height, deviceScaleFactor: 1, mobile: false
          });
          params.clip = { x: 0, y: 0, width, height, scale: 1 };
        }
        const screenshot = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', params);
        if (message.fullPage) {
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride').catch(() => { });
        }
        sendResponse({ data: { screenshot: screenshot.data, format: 'png', encoding: 'base64' } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Query elements by selector =====
  if (message.type === 'CDP_QUERY_ELEMENTS') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const selector = message.selector;
        const limit = message.limit || 20;

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, lim) => {
            const els = document.querySelectorAll(sel);
            const items = [];
            for (let i = 0; i < Math.min(els.length, lim); i++) {
              const el = els[i];
              const rect = el.getBoundingClientRect();
              const attrs = {};
              for (const name of ['id', 'class', 'href', 'type', 'value', 'placeholder', 'name', 'aria-label', 'role', 'src', 'alt', 'title', 'action', 'data-testid']) {
                const v = el.getAttribute(name);
                if (v) attrs[name] = v.substring(0, 200);
              }
              items.push({
                index: i,
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.textContent || '').substring(0, 200).trim(),
                attrs,
                box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                visible: rect.width > 0 && rect.height > 0 && getComputedStyle(el).display !== 'none'
              });
            }
            return { total: els.length, elements: items };
          },
          args: [selector, limit]
        });
        sendResponse({ data: results[0]?.result || { total: 0, elements: [] } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Click element by selector =====
  if (message.type === 'CDP_CLICK_ELEMENT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const selector = message.selector;
        const index = message.index || 0;

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, idx) => {
            const els = document.querySelectorAll(sel);
            if (els.length === 0) return { error: `No elements found for: ${sel}` };
            if (idx >= els.length) return { error: `Index ${idx} out of range (${els.length} found)` };

            const el = els[idx];
            el.scrollIntoView({ block: 'center', inline: 'center' });

            // Get element info
            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const text = (el.innerText || el.textContent || '').substring(0, 100).trim();
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;

            // Focus the element
            el.focus();

            // Full mouse event sequence on the element
            const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
            el.dispatchEvent(new MouseEvent('mouseover', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            el.click();

            // For SPAs (YouTube, React Router, etc.): find nearest parent <a> link and click it too
            const parentLink = el.closest('a');
            if (parentLink && parentLink !== el) {
              parentLink.click();
              // If SPA routing didn't trigger, force navigation
              if (parentLink.href && !parentLink.href.startsWith('javascript:')) {
                setTimeout(() => { window.location.href = parentLink.href; }, 100);
              }
            }

            // Direct <a> tag clicked - force navigate if SPA didn't handle it
            if (tag === 'a' && el.href && !el.href.startsWith('javascript:')) {
              setTimeout(() => { window.location.href = el.href; }, 100);
            }

            // For buttons, also try submit
            if (tag === 'button' && el.form) {
              el.form.requestSubmit?.();
            }
            if (el.type === 'submit' && el.form) {
              el.form.requestSubmit?.();
            }

            return {
              clicked: true,
              tag,
              text,
              x: Math.round(cx),
              y: Math.round(cy),
              total: els.length,
              parentLink: parentLink ? parentLink.href : null
            };
          },
          args: [selector, index]
        });

        const info = results[0]?.result || {};
        if (info.error) {
          sendResponse({ error: info.error });
          return;
        }

        if (message.rawCDP) {
          // Fallback to raw CDP mouse events
          try {
            await ensureAttached(tabId);
            await focusTab(tabId); // Bring tab to front for hardware events
            const x = info.x;
            const y = info.y;

            // Mouse move
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
              type: 'mouseMoved', x, y
            });
            await new Promise(r => setTimeout(r, 50));

            // Mouse down
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
              type: 'mousePressed', x, y, button: 'left', clickCount: 1
            });
            await new Promise(r => setTimeout(r, 50));

            // Mouse up
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
              type: 'mouseReleased', x, y, button: 'left', clickCount: 1
            });

            info.rawCDPUsed = true;
          } catch (cdpErr) {
            info.rawCDPError = cdpErr.message;
          }
        } else {
          // If a link was clicked (via JS), wait for navigation and try to play any video
          if (info.parentLink || info.tag === 'a') {
            try {
              // Wait for new page to load
              await new Promise(r => setTimeout(r, 3000));
              await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                  const video = document.querySelector('video');
                  if (video) { video.muted = false; video.play().catch(() => { }); }
                  const playBtn = document.querySelector('.ytp-play-button');
                  if (playBtn) playBtn.click();
                }
              });
            } catch { /* best effort */ }
          }
          sendResponse({ data: info });
        }
      } catch (err) {
        if (err.message && (err.message.includes('frame') || err.message.includes('removed') || err.message.includes('closed') || err.message.includes('context'))) {
          sendResponse({ data: { clicked: true, note: 'Page navigated or frame destroyed during click' } });
        } else {
          sendResponse({ error: err.message });
        }
      }
    })();
    return true;
  }

  // ===== CDP: Fill input by selector =====
  if (message.type === 'CDP_FILL_INPUT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const selector = message.selector;
        const value = message.value;
        const index = message.index || 0;

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, val, idx) => {
            const els = document.querySelectorAll(sel);
            if (els.length === 0) return { error: `No elements found for: ${sel}` };
            if (idx >= els.length) return { error: `Index ${idx} out of range (${els.length} found)` };

            const el = els[idx];
            el.scrollIntoView({ block: 'center' });
            el.focus();
            el.click();

            // Use native setter to bypass React/Vue interceptors
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

            // Clear
            if (nativeSetter) nativeSetter.call(el, '');
            else el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));

            // Set new value
            if (nativeSetter) nativeSetter.call(el, val);
            else el.value = val;

            // Fire all relevant events
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

            return {
              filled: true,
              tag: el.tagName.toLowerCase(),
              actualValue: el.value,
              verified: el.value === val
            };
          },
          args: [selector, value, index]
        });

        const info = results[0]?.result || {};
        if (info.error) {
          sendResponse({ error: info.error });
          return;
        }

        if (message.rawCDP) {
          try {
            await ensureAttached(tabId);

            // Wait for focus
            await new Promise(r => setTimeout(r, 100));

            // Insert text using raw CDP
            await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: message.value });

            info.rawCDPUsed = true;
          } catch (cdpErr) {
            info.rawCDPError = cdpErr.message;
          }
        }

        sendResponse({
          data: {
            filled: info.filled,
            selector: message.selector,
            requestedValue: message.value,
            actualValue: info.actualValue,
            verified: info.verified,
            rawCDPUsed: info.rawCDPUsed,
            rawCDPError: info.rawCDPError
          }
        });
      } catch (err) {
        if (err.message && (err.message.includes('frame') || err.message.includes('removed') || err.message.includes('closed') || err.message.includes('context'))) {
          sendResponse({ data: { filled: true, note: 'Page navigated or frame destroyed during fill' } });
        } else {
          sendResponse({ error: err.message });
        }
      }
    })();
    return true;
  }

  // ===== CDP: Scroll =====
  if (message.type === 'CDP_SCROLL') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const direction = message.direction || 'down';
        const amount = message.amount || 500;
        const selector = message.selector;

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (dir, amt, sel) => {
            if (sel) {
              const el = document.querySelector(sel);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return { scrolled: true, target: sel };
              }
              return { error: `Element not found: ${sel}` };
            }

            switch (dir) {
              case 'up': window.scrollBy(0, -amt); break;
              case 'down': window.scrollBy(0, amt); break;
              case 'top': window.scrollTo(0, 0); break;
              case 'bottom': window.scrollTo(0, document.body.scrollHeight); break;
              default: window.scrollBy(0, amt);
            }

            return {
              scrolled: true,
              direction: dir,
              scrollX: Math.round(window.scrollX),
              scrollY: Math.round(window.scrollY),
              scrollHeight: document.body.scrollHeight,
              viewportHeight: window.innerHeight
            };
          },
          args: [direction, amount, selector]
        });

        const info = results[0]?.result || {};
        if (info.error) {
          sendResponse({ error: info.error });
        } else {
          sendResponse({ data: info });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Press key =====
  if (message.type === 'CDP_PRESS_KEY') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const key = message.key;
        const modifiers = message.modifiers || '';

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (k, modStr) => {
            const mods = modStr ? modStr.toLowerCase().split(',').map(m => m.trim()) : [];
            const opts = {
              key: k,
              code: k.length === 1 ? 'Key' + k.toUpperCase() : k,
              bubbles: true,
              cancelable: true,
              ctrlKey: mods.includes('ctrl'),
              shiftKey: mods.includes('shift'),
              altKey: mods.includes('alt'),
              metaKey: mods.includes('meta')
            };

            const target = document.activeElement || document.body;
            target.dispatchEvent(new KeyboardEvent('keydown', opts));
            target.dispatchEvent(new KeyboardEvent('keypress', opts));
            target.dispatchEvent(new KeyboardEvent('keyup', opts));

            // Enter = submit form
            if (k === 'Enter' && target.form) {
              target.form.requestSubmit?.() || target.form.submit();
            }

            return { pressed: true, key: k, target: target.tagName?.toLowerCase() || 'body' };
          },
          args: [key, modifiers]
        });

        const info = results[0]?.result || {};

        if (message.rawCDP) {
          try {
            await ensureAttached(tabId);
            const modStr = modifiers ? modifiers.toLowerCase() : '';
            let cdpModifiers = 0;
            if (modStr.includes('alt')) cdpModifiers |= 1;
            if (modStr.includes('ctrl')) cdpModifiers |= 2;
            if (modStr.includes('meta')) cdpModifiers |= 4;
            if (modStr.includes('shift')) cdpModifiers |= 8;

            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyDown',
              key: key,
              code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
              modifiers: cdpModifiers
            });
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: key,
              code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
              modifiers: cdpModifiers
            });
            info.rawCDPUsed = true;
          } catch (cdpErr) {
            info.rawCDPError = cdpErr.message;
          }
        }

        sendResponse({ data: { pressed: true, key, modifiers: modifiers || 'none', target: info.target, rawCDPUsed: info.rawCDPUsed, rawCDPError: info.rawCDPError } });
      } catch (err) {
        if (err.message && (err.message.includes('frame') || err.message.includes('removed') || err.message.includes('closed') || err.message.includes('context'))) {
          sendResponse({ data: { pressed: true, note: 'Page navigated or frame destroyed during key press' } });
        } else {
          sendResponse({ error: err.message });
        }
      }
    })();
    return true;
  }

  // ===== CDP: Execute a raw CDP command (debugger required) =====
  if (message.type === 'CDP_EXECUTE') {
    (async () => {
      try {
        const tabId = await ensureAttached(message.tabId);
        const result = await chrome.debugger.sendCommand({ tabId }, message.method, message.params || {});
        sendResponse({ data: result || {} });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== CDP: Type text into focused element =====
  if (message.type === 'CDP_TYPE_TEXT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const text = message.text;

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (txt) => {
            const el = document.activeElement;
            if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable)) {
              return { error: 'No input element is focused. Use cdp_click_element or cdp_fill_input first.' };
            }

            if (el.isContentEditable) {
              // For contenteditable elements
              document.execCommand('insertText', false, txt);
            } else {
              // For input/textarea, use native setter
              const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              const currentVal = el.value || '';
              const newVal = currentVal + txt;
              if (nativeSetter) nativeSetter.call(el, newVal);
              else el.value = newVal;

              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            return { typed: true, text: txt, element: el.tagName.toLowerCase() };
          },
          args: [text]
        });

        const info = results[0]?.result || {};
        if (info.error) {
          sendResponse({ error: info.error });
          return;
        }

        if (message.rawCDP) {
          try {
            await ensureAttached(tabId);
            await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: message.text });
            info.rawCDPUsed = true;
          } catch (cdpErr) {
            info.rawCDPError = cdpErr.message;
          }
        }

        sendResponse({ data: info });
      } catch (err) {
        if (err.message && (err.message.includes('frame') || err.message.includes('removed') || err.message.includes('closed') || err.message.includes('context'))) {
          sendResponse({ data: { typed: true, note: 'Page navigated or frame destroyed during typing' } });
        } else {
          sendResponse({ error: err.message });
        }
      }
    })();
    return true;
  }

  // ===== Smart: Wait for element =====
  if (message.type === 'CDP_WAIT_FOR') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const selector = message.selector;
        const timeout = message.timeout || 10000;
        const interval = 300;
        const maxAttempts = Math.ceil(timeout / interval);

        for (let i = 0; i < maxAttempts; i++) {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (sel) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const rect = el.getBoundingClientRect();
              const vis = rect.width > 0 && rect.height > 0;
              return { found: true, visible: vis, tag: el.tagName.toLowerCase(), text: (el.innerText || '').substring(0, 100).trim() };
            },
            args: [selector]
          });
          const info = results?.[0]?.result;
          if (info && info.found && (!message.visible || info.visible)) {
            sendResponse({ data: { ...info, waited: i * interval + 'ms' } });
            return;
          }
          await new Promise(r => setTimeout(r, interval));
        }
        sendResponse({ error: `Element "${selector}" not found after ${timeout}ms` });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Select dropdown option =====
  if (message.type === 'CDP_SELECT_OPTION') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, val, byText) => {
            const select = document.querySelector(sel);
            if (!select || select.tagName !== 'SELECT') return { error: `No <select> found for: ${sel}` };

            let matched = false;
            for (const opt of select.options) {
              if (byText ? opt.text.trim() === val : opt.value === val) {
                select.value = opt.value;
                matched = true;
                break;
              }
            }
            if (!matched) return { error: `Option "${val}" not found` };

            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
            return { selected: true, value: select.value, text: select.options[select.selectedIndex]?.text };
          },
          args: [message.selector, message.value, message.byText || false]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Check/uncheck checkbox or radio =====
  if (message.type === 'CDP_CHECK') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, checked) => {
            const el = document.querySelector(sel);
            if (!el) return { error: `Element not found: ${sel}` };
            if (el.type !== 'checkbox' && el.type !== 'radio') return { error: `Element is not a checkbox/radio: ${el.type}` };

            if (el.checked !== checked) {
              el.click();
            }
            return { checked: el.checked, type: el.type, name: el.name };
          },
          args: [message.selector, message.checked !== false]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Hover element =====
  if (message.type === 'CDP_HOVER') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => {
            const el = document.querySelector(sel);
            if (!el) return { error: `Element not found: ${sel}` };
            el.scrollIntoView({ block: 'center' });
            const rect = el.getBoundingClientRect();
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
            el.dispatchEvent(new MouseEvent('mouseenter', opts));
            el.dispatchEvent(new MouseEvent('mouseover', opts));
            el.dispatchEvent(new MouseEvent('mousemove', opts));
            return { hovered: true, tag: el.tagName.toLowerCase(), text: (el.innerText || '').substring(0, 80).trim(), x: Math.round(cx), y: Math.round(cy) };
          },
          args: [message.selector]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Get element text/value =====
  if (message.type === 'CDP_GET_TEXT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => {
            const el = document.querySelector(sel);
            if (!el) return { error: `Element not found: ${sel}` };
            return {
              tag: el.tagName.toLowerCase(),
              text: (el.innerText || el.textContent || '').trim(),
              value: el.value ?? null,
              href: el.href ?? null,
              src: el.src ?? null,
              checked: el.checked ?? null,
              selectedOption: el.selectedOptions?.[0]?.text ?? null
            };
          },
          args: [message.selector]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Find text on page =====
  if (message.type === 'CDP_FIND_TEXT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (searchText) => {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            const matches = [];
            let node;
            while ((node = walk.nextNode()) && matches.length < 10) {
              if (node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
                const parent = node.parentElement;
                if (!parent) continue;
                const rect = parent.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                // Find nearest interactive element
                const interactive = parent.closest('a, button, input, [role="button"], [role="link"]');
                let selector = '';
                if (parent.id) selector = `#${parent.id}`;
                else if (parent.className) selector = `${parent.tagName.toLowerCase()}.${Array.from(parent.classList).join('.')}`;
                else selector = parent.tagName.toLowerCase();

                matches.push({
                  text: node.textContent.trim().substring(0, 150),
                  element: parent.tagName.toLowerCase(),
                  selector,
                  nearestInteractive: interactive ? {
                    tag: interactive.tagName.toLowerCase(),
                    text: (interactive.innerText || '').substring(0, 80).trim(),
                    href: interactive.href || null,
                    selector: interactive.id ? `#${interactive.id}` : (interactive.className ? `${interactive.tagName.toLowerCase()}.${Array.from(interactive.classList).join('.')}` : interactive.tagName.toLowerCase())
                  } : null,
                  y: Math.round(rect.y)
                });
              }
            }
            return { query: searchText, count: matches.length, matches };
          },
          args: [message.text]
        });
        sendResponse({ data: results[0]?.result || { count: 0, matches: [] } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Go back =====
  if (message.type === 'CDP_GO_BACK') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        await chrome.scripting.executeScript({ target: { tabId }, func: () => history.back() });
        await new Promise(r => setTimeout(r, 1500));
        const tab = await chrome.tabs.get(tabId);
        sendResponse({ data: { url: tab.url, title: tab.title } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Go forward =====
  if (message.type === 'CDP_GO_FORWARD') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        await chrome.scripting.executeScript({ target: { tabId }, func: () => history.forward() });
        await new Promise(r => setTimeout(r, 1500));
        const tab = await chrome.tabs.get(tabId);
        sendResponse({ data: { url: tab.url, title: tab.title } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Open new tab =====
  if (message.type === 'CDP_NEW_TAB') {
    (async () => {
      try {
        const tab = await chrome.tabs.create({ url: message.url || 'about:blank', active: true });
        if (message.url && message.url !== 'about:blank') {
          await new Promise(r => setTimeout(r, 2000));
        }
        const updated = await chrome.tabs.get(tab.id);
        sendResponse({ data: { tabId: updated.id, url: updated.url, title: updated.title } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Switch tab =====
  if (message.type === 'CDP_SWITCH_TAB') {
    (async () => {
      try {
        if (message.tabId) {
          await chrome.tabs.update(message.tabId, { active: true });
          const tab = await chrome.tabs.get(message.tabId);
          sendResponse({ data: { tabId: tab.id, url: tab.url, title: tab.title } });
        } else {
          // List all tabs for selection
          const tabs = await chrome.tabs.query({ currentWindow: true });
          sendResponse({
            data: {
              tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active }))
            }
          });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Close tab =====
  if (message.type === 'CDP_CLOSE_TAB') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        await chrome.tabs.remove(tabId);
        if (cdpAttachedTabs.has(tabId)) cdpAttachedTabs.delete(tabId);
        sendResponse({ data: { closed: true, tabId } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Handle dialog (alert/confirm/prompt) =====
  if (message.type === 'CDP_HANDLE_DIALOG') {
    (async () => {
      try {
        const tabId = await ensureAttached(message.tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

        // Set up handler for dialog
        const accept = message.accept !== false;
        const promptText = message.promptText || '';

        await chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', {
          accept,
          promptText
        });
        sendResponse({ data: { handled: true, accepted: accept } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Smart: Extract structured data (tables, lists) =====
  if (message.type === 'CDP_EXTRACT_DATA') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => {
            const el = document.querySelector(sel);
            if (!el) return { error: `Element not found: ${sel}` };

            // Table extraction
            if (el.tagName === 'TABLE') {
              const headers = [...el.querySelectorAll('th')].map(th => th.innerText.trim());
              const rows = [...el.querySelectorAll('tbody tr, tr')].map(tr =>
                [...tr.querySelectorAll('td, th')].map(td => td.innerText.trim())
              );
              return { type: 'table', headers, rows: rows.slice(0, 100), totalRows: rows.length };
            }

            // List extraction
            if (el.tagName === 'UL' || el.tagName === 'OL') {
              const items = [...el.querySelectorAll('li')].map(li => li.innerText.trim());
              return { type: 'list', items: items.slice(0, 100), totalItems: items.length };
            }

            // Generic: return text + children
            return {
              type: 'element',
              tag: el.tagName.toLowerCase(),
              text: el.innerText?.substring(0, 3000) || '',
              childCount: el.children.length
            };
          },
          args: [message.selector]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: Cookie management =====
  if (message.type === 'CDP_COOKIES') {
    (async () => {
      try {
        const tabId = await ensureAttached(message.tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable');

        if (message.action === 'get') {
          const result = await chrome.debugger.sendCommand({ tabId }, 'Network.getCookies', {
            urls: message.urls || []
          });
          sendResponse({ data: { cookies: result.cookies } });
        } else if (message.action === 'set') {
          await chrome.debugger.sendCommand({ tabId }, 'Network.setCookie', {
            name: message.name,
            value: message.value,
            domain: message.domain,
            path: message.path || '/',
            secure: message.secure || false,
            httpOnly: message.httpOnly || false
          });
          sendResponse({ data: { set: true, name: message.name } });
        } else if (message.action === 'delete') {
          await chrome.debugger.sendCommand({ tabId }, 'Network.deleteCookies', {
            name: message.name,
            domain: message.domain
          });
          sendResponse({ data: { deleted: true, name: message.name } });
        } else if (message.action === 'clear') {
          await chrome.debugger.sendCommand({ tabId }, 'Network.clearBrowserCookies');
          sendResponse({ data: { cleared: true } });
        } else {
          sendResponse({ error: 'Unknown cookie action. Use: get, set, delete, clear' });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: Network monitoring =====
  if (message.type === 'CDP_NETWORK') {
    (async () => {
      try {
        const tabId = await ensureAttached(message.tabId);

        if (message.action === 'getRequests') {
          // Get recent network entries via Performance API
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (filter) => {
              const entries = performance.getEntriesByType('resource');
              let filtered = entries;
              if (filter) {
                filtered = entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()));
              }
              return filtered.slice(-50).map(e => ({
                url: e.name,
                type: e.initiatorType,
                duration: Math.round(e.duration),
                size: e.transferSize || 0,
                status: e.responseStatus || null
              }));
            },
            args: [message.filter || null]
          });
          sendResponse({ data: { requests: results[0]?.result || [] } });
        } else if (message.action === 'intercept') {
          await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', {
            patterns: [{ urlPattern: message.pattern || '*', requestStage: 'Request' }]
          });
          sendResponse({ data: { intercepting: true, pattern: message.pattern || '*' } });
        } else if (message.action === 'stopIntercept') {
          await chrome.debugger.sendCommand({ tabId }, 'Fetch.disable');
          sendResponse({ data: { intercepting: false } });
        } else {
          sendResponse({ error: 'Unknown network action. Use: getRequests, intercept, stopIntercept' });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: File upload =====
  if (message.type === 'CDP_FILE_UPLOAD') {
    (async () => {
      try {
        const tabId = await ensureAttached(message.tabId);

        // First find the file input node via DOM
        await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
        const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument');
        const nodeResult = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: message.selector
        });

        if (!nodeResult.nodeId) {
          sendResponse({ error: `File input not found: ${message.selector}` });
          return;
        }

        await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
          files: Array.isArray(message.files) ? message.files : [message.files],
          nodeId: nodeResult.nodeId
        });

        sendResponse({ data: { uploaded: true, selector: message.selector, files: message.files } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: iFrame execution =====
  if (message.type === 'CDP_IFRAME') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (iframeSel, code) => {
            const iframe = document.querySelector(iframeSel);
            if (!iframe) return { error: `iFrame not found: ${iframeSel}` };
            try {
              const doc = iframe.contentDocument || iframe.contentWindow?.document;
              if (!doc) return { error: 'Cannot access iFrame (cross-origin?)' };
              const fn = new Function('document', 'window', code);
              const result = fn(doc, iframe.contentWindow);
              return { executed: true, result: typeof result === 'object' ? JSON.stringify(result) : String(result) };
            } catch (e) {
              return { error: `iFrame execution error: ${e.message}` };
            }
          },
          args: [message.iframeSelector, message.code]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: Highlight element =====
  if (message.type === 'CDP_HIGHLIGHT') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, duration) => {
            const el = document.querySelector(sel);
            if (!el) return { error: `Element not found: ${sel}` };
            el.scrollIntoView({ block: 'center' });
            const orig = el.style.cssText;
            el.style.outline = '3px solid #ff4444';
            el.style.outlineOffset = '2px';
            el.style.boxShadow = '0 0 10px rgba(255,68,68,0.5)';
            setTimeout(() => { el.style.cssText = orig; }, duration || 2000);
            return { highlighted: true, tag: el.tagName.toLowerCase(), text: (el.innerText || '').substring(0, 80).trim() };
          },
          args: [message.selector, message.duration || 2000]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: Wait for network idle =====
  if (message.type === 'CDP_WAIT_IDLE') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const timeout = message.timeout || 10000;
        const idleTime = message.idleTime || 500;
        const start = Date.now();

        // Poll for no new network activity
        let lastCount = -1;
        while (Date.now() - start < timeout) {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({
              readyState: document.readyState,
              resourceCount: performance.getEntriesByType('resource').length,
              pending: document.querySelectorAll('img[src]:not([complete]), script[src]:not([async])').length
            })
          });
          const info = results?.[0]?.result;
          if (info) {
            if (info.readyState === 'complete' && info.resourceCount === lastCount && info.pending === 0) {
              sendResponse({ data: { idle: true, waited: Date.now() - start + 'ms', resources: info.resourceCount } });
              return;
            }
            lastCount = info.resourceCount;
          }
          await new Promise(r => setTimeout(r, idleTime));
        }
        sendResponse({ data: { idle: false, timedOut: true, waited: timeout + 'ms' } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: Console log capture =====
  if (message.type === 'CDP_CONSOLE') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (maxEntries) => {
            // Inject console capture if not already present
            if (!window.__cdpConsoleLogs) {
              window.__cdpConsoleLogs = [];
              const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
              ['log', 'warn', 'error', 'info'].forEach(level => {
                console[level] = (...args) => {
                  window.__cdpConsoleLogs.push({
                    level,
                    message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
                    time: Date.now()
                  });
                  if (window.__cdpConsoleLogs.length > 200) window.__cdpConsoleLogs.shift();
                  orig[level](...args);
                };
              });
              // Capture uncaught errors
              window.addEventListener('error', (e) => {
                window.__cdpConsoleLogs.push({ level: 'error', message: `Uncaught: ${e.message} (${e.filename}:${e.lineno})`, time: Date.now() });
              });
            }
            return { logs: window.__cdpConsoleLogs.slice(-(maxEntries || 50)), total: window.__cdpConsoleLogs.length };
          },
          args: [message.maxEntries || 50]
        });
        sendResponse({ data: results[0]?.result || { logs: [], total: 0 } });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Advanced: Drag and drop =====
  if (message.type === 'CDP_DRAG_DROP') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (fromSel, toSel) => {
            const from = document.querySelector(fromSel);
            const to = document.querySelector(toSel);
            if (!from) return { error: `Source element not found: ${fromSel}` };
            if (!to) return { error: `Target element not found: ${toSel}` };

            from.scrollIntoView({ block: 'center' });
            const fromRect = from.getBoundingClientRect();
            const toRect = to.getBoundingClientRect();
            const fx = fromRect.x + fromRect.width / 2;
            const fy = fromRect.y + fromRect.height / 2;
            const tx = toRect.x + toRect.width / 2;
            const ty = toRect.y + toRect.height / 2;

            // HTML5 Drag Events
            const dataTransfer = new DataTransfer();
            from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer, clientX: fx, clientY: fy }));
            to.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer, clientX: tx, clientY: ty }));
            to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: tx, clientY: ty }));
            to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: tx, clientY: ty }));
            from.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer, clientX: tx, clientY: ty }));

            return {
              dragged: true,
              from: { tag: from.tagName.toLowerCase(), text: (from.innerText || '').substring(0, 50).trim() },
              to: { tag: to.tagName.toLowerCase(), text: (to.innerText || '').substring(0, 50).trim() }
            };
          },
          args: [message.fromSelector, message.toSelector]
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Visual: Smart element locator =====
  if (message.type === 'CDP_SMART_LOCATE') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (query, strategy) => {
            const q = (query || '').toLowerCase().trim();
            if (!q) return { error: 'No search query provided' };

            const matches = [];
            const allEls = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], label, h1, h2, h3, h4, h5, h6, [contenteditable]');

            for (const el of allEls) {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              const style = getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

              const text = (el.innerText || el.textContent || '').trim().toLowerCase().substring(0, 200);
              const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
              const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
              const title = (el.getAttribute('title') || '').toLowerCase();
              const alt = (el.getAttribute('alt') || '').toLowerCase();
              const name = (el.getAttribute('name') || '').toLowerCase();
              const id = (el.id || '').toLowerCase();
              const type = (el.getAttribute('type') || '').toLowerCase();
              const role = (el.getAttribute('role') || '').toLowerCase();
              const value = (el.value || '').toLowerCase();
              const href = (el.href || '').toLowerCase();

              // Score how well this element matches the query
              let score = 0;
              let matchReason = '';

              // Exact text match
              if (text === q) { score += 100; matchReason = 'exact text'; }
              else if (text.includes(q)) { score += 60; matchReason = 'contains text'; }
              else if (ariaLabel.includes(q)) { score += 80; matchReason = 'aria-label'; }
              else if (placeholder.includes(q)) { score += 70; matchReason = 'placeholder'; }
              else if (title.includes(q)) { score += 65; matchReason = 'title'; }
              else if (alt.includes(q)) { score += 55; matchReason = 'alt text'; }
              else if (name.includes(q)) { score += 50; matchReason = 'name attr'; }
              else if (id.includes(q)) { score += 45; matchReason = 'id'; }
              else if (value.includes(q)) { score += 40; matchReason = 'value'; }
              else if (href.includes(q)) { score += 30; matchReason = 'href'; }

              // Fuzzy: check if individual words match
              if (score === 0) {
                const words = q.split(/\s+/);
                const allText = `${text} ${ariaLabel} ${placeholder} ${title} ${alt} ${name} ${id}`;
                const wordMatches = words.filter(w => w.length > 2 && allText.includes(w));
                if (wordMatches.length > 0) {
                  score = 20 + (wordMatches.length / words.length) * 30;
                  matchReason = `fuzzy: ${wordMatches.join(', ')}`;
                }
              }

              if (score === 0) continue;

              // Build a unique CSS selector
              let selector = '';
              if (el.id) selector = `#${CSS.escape(el.id)}`;
              else {
                const tag = el.tagName.toLowerCase();
                if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
                else if (ariaLabel) selector = `${tag}[aria-label="${el.getAttribute('aria-label')}"]`;
                else if (el.name) selector = `${tag}[name="${el.name}"]`;
                else if (placeholder) selector = `${tag}[placeholder="${el.getAttribute('placeholder')}"]`;
                else {
                  // Generate nth-child selector
                  const parent = el.parentElement;
                  if (parent) {
                    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
                    const idx = siblings.indexOf(el);
                    selector = `${tag}:nth-of-type(${idx + 1})`;
                    // Walk up to make it unique
                    let unique = parent.id ? `#${CSS.escape(parent.id)} > ${selector}` : selector;
                    if (document.querySelectorAll(unique).length !== 1 && parent.id) {
                      selector = unique;
                    }
                  } else {
                    selector = tag;
                  }
                }
              }

              matches.push({
                score,
                matchReason,
                selector,
                tag: el.tagName.toLowerCase(),
                text: text.substring(0, 80),
                type: type || undefined,
                role: role || undefined,
                ariaLabel: ariaLabel || undefined,
                bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
              });
            }

            matches.sort((a, b) => b.score - a.score);
            return {
              query: q,
              found: matches.length,
              results: matches.slice(0, 8),
              bestSelector: matches[0]?.selector || null,
              bestMatch: matches[0] || null
            };
          },
          args: [message.query, message.strategy || 'auto']
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ===== Visual: Annotated page map =====
  if (message.type === 'CDP_ANNOTATE_PAGE') {
    (async () => {
      try {
        const tabId = await getTargetTabId(message.tabId);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (filterType) => {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const elements = [];
            let idx = 0;

            // Determine which elements to include
            let selectorList = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick]';
            if (filterType === 'all') {
              selectorList += ', h1, h2, h3, h4, h5, h6, img, video, [contenteditable], label, p, span, div';
            }
            if (filterType === 'forms') {
              selectorList = 'input, select, textarea, button[type="submit"], form, label, [role="checkbox"], [role="radio"], [role="combobox"]';
            }
            if (filterType === 'links') {
              selectorList = 'a, [role="link"]';
            }

            const allEls = document.querySelectorAll(selectorList);
            for (const el of allEls) {
              const rect = el.getBoundingClientRect();
              if (rect.width < 5 || rect.height < 5) continue;
              if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
              const style = getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) continue;

              idx++;
              const tag = el.tagName.toLowerCase();
              const text = (el.innerText || el.textContent || '').trim().substring(0, 60);
              const ariaLabel = el.getAttribute('aria-label') || '';
              const placeholder = el.getAttribute('placeholder') || '';

              // Visual region
              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;
              let region = '';
              if (cy < vh * 0.25) region = 'top';
              else if (cy < vh * 0.75) region = 'middle';
              else region = 'bottom';
              if (cx < vw * 0.25) region += '-left';
              else if (cx < vw * 0.75) region += '-center';
              else region += '-right';

              // Build selector
              let selector = '';
              if (el.id) selector = `#${CSS.escape(el.id)}`;
              else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
              else if (ariaLabel) selector = `${tag}[aria-label="${el.getAttribute('aria-label')}"]`;
              else if (el.name) selector = `${tag}[name="${el.name}"]`;
              else if (placeholder) selector = `${tag}[placeholder="${el.getAttribute('placeholder')}"]`;
              else selector = tag;

              elements.push({
                '#': idx,
                region,
                tag,
                type: el.getAttribute('type') || undefined,
                text: text || ariaLabel || placeholder || undefined,
                selector,
                pos: `${Math.round(rect.x)},${Math.round(rect.y)}`,
                size: `${Math.round(rect.width)}x${Math.round(rect.height)}`
              });

              if (idx >= 100) break; // Cap at 100 elements
            }

            // Group by region
            const grouped = {};
            for (const el of elements) {
              if (!grouped[el.region]) grouped[el.region] = [];
              grouped[el.region].push(el);
            }

            return {
              pageTitle: document.title,
              pageUrl: location.href,
              viewport: `${vw}x${vh}`,
              totalElements: idx,
              regions: grouped,
              flatList: elements
            };
          },
          args: [message.filter || 'interactive']
        });
        const info = results[0]?.result || {};
        if (info.error) sendResponse({ error: info.error });
        else sendResponse({ data: info });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});

// ===== CDP: Debugger lifecycle listeners =====

// Clean up when debugger is detached (user closed devtools, navigated to chrome://, etc.)
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (tabId && cdpAttachedTabs.has(tabId)) {
    cdpAttachedTabs.delete(tabId);
    console.log(`[CDP] Debugger detached from tab ${tabId}: ${reason}`);
  }
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (cdpAttachedTabs.has(tabId)) {
    cdpAttachedTabs.delete(tabId);
    console.log(`[CDP] Tab ${tabId} closed, cleaned up attachment`);
  }
});

