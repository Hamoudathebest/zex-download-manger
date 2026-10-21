// content.js — Page scanner / download affordance.
//
// HOW IT RUNS (least privilege, no silent capture):
//  - This file is NOT declared in manifest.json under `content_scripts`
//    with <all_urls>. It is injected only when the user, on that site,
//    has enabled the per-site toggle AND clicks "Scan this page" in the
//    popup (background.js -> chrome.scripting.executeScript, activeTab).
//  - It therefore never runs on a site the user has not opted into, and
//    never downloads anything by itself. It only ADDS a small button next
//    to eligible links/media. Clicking that button is the user's explicit
//    download choice, forwarded via chrome.runtime.sendMessage.
//  - Double-injection guard: if already injected in this page, re-running
//    just re-scans instead of duplicating buttons.
//
// WHAT IT READS (and what it never touches):
//  - Reads ONLY href/src attributes of <a>, <video>, <audio>, <source>
//    elements that are visible on the page, plus their text for a label.
//  - NEVER reads cookies, localStorage/sessionStorage, form values,
//    passwords, or any authenticated / private page data.
//  - Only http(s) URLs are surfaced. blob:, data:, javascript:, file:,
//    and relative URLs that do not resolve to http(s) are skipped.
//    (A blob: URL is local to the page; the desktop app could not fetch
//    it, and forwarding it would leak nothing useful — just fail.)
//  - DRM / protected streams are out of scope: if a <video> has no
//    page-exposed http(s) src/source, nothing is shown for it. This
//    script does not probe network requests, intercept media, or defeat
//    any protection. See README.md "Limitations".

(() => {
  'use strict';

  if (window.__dmNextGenScanned) {
    // Already injected: re-scan (e.g. user clicked "Scan" again after
    // the page changed) without re-registering listeners.
    window.__dmNextGenRescan && window.__dmNextGenRescan();
    return;
  }
  window.__dmNextGenScanned = true;

  const DOWNLOADABLE_EXTS = [
    'zip', 'rar', '7z', 'tar', 'gz', 'pdf',
    'mp4', 'mkv', 'webm', 'mov', 'mp3', 'flac', 'wav', 'ogg',
    'jpg', 'jpeg', 'png', 'gif', 'webp',
    'exe', 'msi', 'dmg', 'iso',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
  ];
  const MAX_BUTTONS_PER_SCAN = 50;
  const BUTTON_ATTR = 'data-dm-nextgen-btn';
  const WRAP_ATTR = 'data-dm-nextgen-wrap';

  function isHttpUrl(value) {
    try {
      const u = new URL(value, window.location.href);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function isVisible(el) {
    if (!el || el.offsetParent === null) {
      // offsetParent is null for <body>/fixed elements too; fall back to rects.
      if (!el || el.getClientRects().length === 0) return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function hasDownloadableExtension(url) {
    try {
      const path = new URL(url, window.location.href).pathname.toLowerCase();
      return DOWNLOADABLE_EXTS.some((ext) => path.endsWith('.' + ext));
    } catch {
      return false;
    }
  }

  function collectCandidates() {
    const found = new Map(); // url -> label (dedupe identical URLs)

    document.querySelectorAll('a[href]').forEach((a) => {
      if (!isVisible(a)) return;
      const href = a.getAttribute('href');
      if (!href || !isHttpUrl(href)) return;
      const absolute = new URL(href, window.location.href).href;
      // Eligible if: it declares download=, OR its path ends in a known
      // downloadable extension. Plain navigation links are NOT surfaced.
      if (a.hasAttribute('download') || hasDownloadableExtension(absolute)) {
        const label = (a.textContent || '').trim().slice(0, 80) || absolute;
        if (!found.has(absolute)) found.set(absolute, { url: absolute, label, anchor: a });
      }
    });

    document.querySelectorAll('video[src], audio[src]').forEach((media) => {
      if (!isVisible(media)) return;
      const src = media.getAttribute('src');
      if (src && isHttpUrl(src)) {
        const absolute = new URL(src, window.location.href).href;
        if (!found.has(absolute)) {
          found.set(absolute, { url: absolute, label: media.tagName.toLowerCase() + ' media', anchor: media });
        }
      }
    });

    document.querySelectorAll('video source[src], audio source[src]').forEach((source) => {
      const parent = source.closest('video, audio');
      if (parent && !isVisible(parent)) return;
      const src = source.getAttribute('src');
      if (src && isHttpUrl(src)) {
        const absolute = new URL(src, window.location.href).href;
        if (!found.has(absolute)) {
          found.set(absolute, { url: absolute, label: 'media source', anchor: parent });
        }
      }
    });

    return [...found.values()];
  }

  function makeButton(candidate) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(BUTTON_ATTR, 'true');
    btn.title = 'Send to Download Manager: ' + candidate.label;
    btn.setAttribute('aria-label', 'Send to Download Manager: ' + candidate.label);
    btn.textContent = '⬇ DM';
    // Inline styles only: no external stylesheet is injected into the page,
    // so this cannot leak styles into (or be styled by) the host page's CSS
    // beyond this one element, and it is removed when disabled.
    btn.style.cssText = [
      'display:inline-block', 'margin-left:6px', 'padding:1px 7px',
      'font-size:12px', 'line-height:1.6', 'font-family:sans-serif',
      'color:#fff', 'background:#1a73e8', 'border:1px solid #1557b0',
      'border-radius:12px', 'cursor:pointer', 'vertical-align:middle',
      'white-space:nowrap', 'z-index:2147483647',
    ].join(';');
    btn.addEventListener('click', (event) => {
      // Explicit user choice: stop the anchor navigating / media playing.
      event.preventDefault();
      event.stopPropagation();
      btn.disabled = true;
      btn.textContent = '…';
      chrome.runtime.sendMessage(
        { type: 'SEND_TO_APP', url: candidate.url, pageUrl: window.location.href },
        (result) => {
          if (chrome.runtime.lastError) {
            btn.disabled = false;
            btn.textContent = '⬇ DM';
            btn.title = 'Could not reach the extension background: ' + chrome.runtime.lastError.message;
            return;
          }
          if (result && result.ok) {
            btn.textContent = '✓ Sent';
            btn.style.background = '#188038';
            btn.style.borderColor = '#137333';
          } else {
            btn.disabled = false;
            btn.textContent = '⬇ DM';
            btn.title = 'Not sent: ' + ((result && result.error) || 'unknown error')
              + '. Open the extension popup to check the app connection.';
          }
        },
      );
    }, true);
    return btn;
  }

  function scan() {
    // Remove stale buttons whose anchor left the DOM, then add new ones.
    document.querySelectorAll('[' + BUTTON_ATTR + ']').forEach((btn) => {
      const anchor = btn.parentElement;
      if (!anchor || !document.contains(anchor)) btn.remove();
    });
    let added = 0;
    for (const candidate of collectCandidates()) {
      if (added >= MAX_BUTTONS_PER_SCAN) break;
      const anchor = candidate.anchor;
      if (!anchor || anchor.querySelector('[' + BUTTON_ATTR + ']')) continue;
      // Never nest a button inside an <a> that would hijack navigation for
      // keyboard users: place it immediately AFTER the element instead,
      // except for media elements where after is also correct.
      try {
        anchor.insertAdjacentElement('afterend', makeButton(candidate));
        added++;
      } catch {
        // insertAdjacentElement can fail on some elements (e.g. inside
        // <svg>); skip rather than breaking the page.
      }
    }
    return { found: collectCandidates().length, surfaced: added };
  }

  function removeAllButtons() {
    document.querySelectorAll('[' + BUTTON_ATTR + ']').forEach((btn) => btn.remove());
  }

  window.__dmNextGenRescan = scan;

  // Initial scan on injection, plus a debounced observer so links added
  // by lazy page scripts get an affordance without constant rescanning.
  scan();
  let debounce = null;
  const observer = new MutationObserver(() => {
    if (debounce) return;
    debounce = setTimeout(() => { debounce = null; scan(); }, 800);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'DM_SET_ENABLED') {
      if (message.enabled) {
        sendResponse(scan());
      } else {
        removeAllButtons();
        try { observer.disconnect(); } catch { /* already stopped */ }
        sendResponse({ surfaced: 0 });
      }
      return true;
    }
    if (message && message.type === 'DM_SCAN') {
      sendResponse(scan());
      return true;
    }
    return false;
  });
})();
