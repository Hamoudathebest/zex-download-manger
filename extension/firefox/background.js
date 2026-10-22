// Firefox adaptation: use the browser.* namespace when present,
// otherwise fall back to chrome.*. The rest of this file is the
// Chrome/Edge/Brave implementation unchanged, except that every
// chrome.* call below resolves through this shim. UNTESTED in
// Firefox (no Firefox available on the Linux build machine).
const chrome = globalThis.browser ?? globalThis.chrome;

// background.js — Manifest V3 service worker (ephemeral, no persistent port).
//
// Responsibilities:
//  1. Context-menu downloads (explicit user choice only).
//  2. Native Messaging connection to the desktop app (short-lived, per request).
//  3. Message routing between popup / content script and the native host.
//  4. Per-origin on/off settings in chrome.storage.local.
//
// Hard rules (see README.md):
//  - NEVER read, forward, or store cookies, passwords, tokens, or credentials.
//  - NEVER silently capture a download. Every send originates from an explicit
//    user action: a context-menu click, a popup button, or a content-script
//    affordance button click.
//  - Only http(s) URLs are forwarded. blob:, data:, javascript:, file: and
//    other schemes are rejected — a desktop app cannot meaningfully fetch a
//    page-local blob, and forwarding anything else would be unsafe.
//  - No setInterval / alarms / long-lived native port: MV3 service workers
//    are terminated when idle. Each native request opens, uses, and closes
//    its own port. The host must therefore be stateless per message, or the
//    desktop app must re-hydrate state from its own store, not from us.

const NATIVE_HOST = 'com.downloadmanager.nextgen';

// Message protocol shared with the (separately built) desktop host.
// The host implementation is NOT in this repo (Phase 1 = extension only).
// Wire format is the standard Native Messaging framing: a 4-byte
// little-endian length prefix followed by one UTF-8 JSON message.
// Logical messages:
//   Extension -> Host: { type: 'ping' }
//                         { type: 'download_request', url, filename?, pageUrl? }
//   Host -> Extension: { type: 'pong', hostVersion? }
//                         { type: 'download_ack', url, queued: true }
//                         { type: 'download_error', url, error }

const DOWNLOADABLE_RE = /\.(zip|rar|7z|tar|gz|pdf|mp4|mkv|webm|mov|mp3|flac|wav|ogg|jpg|jpeg|png|gif|webp|exe|msi|dmg|iso|doc|docx|xls|xlsx|ppt|pptx|txt|csv)(\?.*)?(#.*)?$/i;

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function isSiteEnabled(origin) {
  if (!origin) return false;
  const data = await chrome.storage.local.get(`site:${origin}`);
  // Default is OFF until the user explicitly enables a site in the popup.
  // This is deliberate: least surprise, no capture on sites never opted in.
  return data[`site:${origin}`] === true;
}

function filenameFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last) || null;
  } catch {
    return null;
  }
}

/**
 * Send one request to the native host over a short-lived port.
 * Resolves with the host's first reply, rejects on disconnect/error.
 * A timeout guards against a host that connects but never replies.
 */
function callNativeHost(message, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let port;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { port.disconnect(); } catch { /* already gone */ }
      reject(new Error('Native host did not reply in time.'));
    }, timeoutMs);
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    port.onMessage.addListener((reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch { /* ignore */ }
      resolve(reply);
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = chrome.runtime.lastError
        ? new Error(chrome.runtime.lastError.message)
        : new Error('Native host disconnected without a reply. Is it installed and paired? See native-host/PAIRING.md.');
      reject(err);
    });
    port.postMessage(message);
  });
}

/** Ping the host. Used only for the popup's explicit "Check connection". */
async function checkConnection() {
  try {
    const reply = await callNativeHost({ type: 'ping' }, 5000);
    if (reply && (reply.type === 'pong' || reply.ok === true)) {
      return { status: 'connected', hostVersion: reply.hostVersion || null, checkedAt: Date.now() };
    }
    return { status: 'unknown', error: 'Host replied, but not with an expected pong message.', checkedAt: Date.now() };
  } catch (err) {
    return { status: 'disconnected', error: err.message, checkedAt: Date.now() };
  }
}

/**
 * Forward one user-chosen URL to the desktop app.
 * Returns { ok, queued?, error? }. Never falls back to a browser download
 * silently — the popup offers that as a separate, explicit second step.
 */
async function sendToApp({ url, pageUrl }) {
  if (!isHttpUrl(url)) {
    return { ok: false, error: 'Only http(s) links can be sent to the desktop app.' };
  }
  const origin = pageUrl ? originOf(pageUrl) : originOf(url);
  if (pageUrl && !(await isSiteEnabled(origin))) {
    return { ok: false, error: `Download Manager is turned off for ${origin}. Enable it in the popup first.` };
  }
  try {
    const reply = await callNativeHost({
      type: 'download_request',
      url,
      filename: filenameFromUrl(url),
      pageUrl: pageUrl || null,
    });
    if (reply && (reply.type === 'download_ack' || reply.queued === true)) {
      return { ok: true, queued: true };
    }
    if (reply && reply.type === 'download_error') {
      return { ok: false, error: reply.error || 'Desktop app reported an error.' };
    }
    return { ok: false, error: 'Desktop app replied with an unexpected message.' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Context menus (created on install; recreated on startup in case of drift)
// ---------------------------------------------------------------------------

const MENU_LINK = 'dm-send-link';
const MENU_MEDIA = 'dm-send-media';

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_LINK,
      title: 'Send link to Download Manager',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: MENU_MEDIA,
      title: 'Send media to Download Manager',
      contexts: ['video', 'audio', 'image'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => createMenus());
chrome.runtime.onStartup.addListener(() => createMenus());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // info.linkUrl (link context) or info.srcUrl (video/audio/image context).
  const url = info.linkUrl || info.srcUrl;
  const pageUrl = tab && tab.url ? tab.url : (info.pageUrl || null);
  if (!url || !isHttpUrl(url)) return; // Silently ignore non-http(s) targets.
  const result = await sendToApp({ url, pageUrl });
  // Service workers cannot show a popup; record the outcome so the popup
  // can display it next time it opens. Never claim success we did not get.
  await chrome.storage.local.set({
    lastSend: { url, pageUrl, ok: result.ok, error: result.error || null, at: Date.now() },
  });
  if (!result.ok) {
    // Best-effort user-visible signal without inventing a notification
    // permission we do not hold: badge text on the action icon.
    try {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
    } catch { /* action badge is best-effort only */ }
  }
});

// ---------------------------------------------------------------------------
// Message routing: popup <-> background, content script <-> background
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message && message.type) {
      case 'GET_STATUS': {
        sendResponse(await checkConnection());
        break;
      }
      case 'SEND_TO_APP': {
        sendResponse(await sendToApp({
          url: message.url,
          pageUrl: message.pageUrl || (sender.tab && sender.tab.url) || null,
        }));
        break;
      }
      case 'BROWSER_DOWNLOAD': {
        // Explicit fallback ONLY: the popup shows this button after a
        // native-host failure and the user clicks it deliberately.
        if (!isHttpUrl(message.url)) {
          sendResponse({ ok: false, error: 'Only http(s) links can be downloaded.' });
          break;
        }
        try {
          const downloadId = await chrome.downloads.download({ url: message.url, saveAs: false });
          sendResponse({ ok: true, downloadId });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }
      case 'GET_SITE_SETTING': {
        const origin = message.origin;
        sendResponse({ origin, enabled: origin ? await isSiteEnabled(origin) : false });
        break;
      }
      case 'SET_SITE_SETTING': {
        if (!message.origin) {
          sendResponse({ ok: false, error: 'No origin supplied.' });
          break;
        }
        await chrome.storage.local.set({ [`site:${message.origin}`]: message.enabled === true });
        sendResponse({ ok: true, origin: message.origin, enabled: message.enabled === true });
        break;
      }
      case 'GET_LAST_SEND': {
        const data = await chrome.storage.local.get('lastSend');
        sendResponse(data.lastSend || null);
        break;
      }
      case 'INJECT_CONTENT_SCRIPT': {
        // Popup-driven injection (activeTab + scripting). The content
        // script is NOT auto-injected on every page: it runs only when
        // the user enables the site and clicks "Scan this page".
        // sender is the popup, so message.tabId must be supplied by it.
        if (!message.tabId) {
          sendResponse({ ok: false, error: 'No tabId supplied.' });
          break;
        }
        try {
          await chrome.scripting.executeScript({
            target: { tabId: message.tabId },
            files: ['content.js'],
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type.' });
    }
  })();
  return true; // Keep the message channel open for the async reply.
});
// (DOWNLOADABLE_RE above is kept for reviewers; the live check in this
// file is isHttpUrl(), extension filtering lives in content.js.)
