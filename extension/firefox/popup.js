// Firefox adaptation: use the browser.* namespace when present,
// otherwise fall back to chrome.*. The rest of this file is the
// Chrome/Edge/Brave implementation unchanged, except that every
// chrome.* call below resolves through this shim. UNTESTED in
// Firefox (no Firefox available on the Linux build machine).
const chrome = globalThis.browser ?? globalThis.chrome;

// popup.js — Popup logic only. No background execution, no silent work.
//
// Flow:
//  1. Read the active tab's URL (activeTab grants this on popup open).
//     If it is not http(s) (e.g. chrome://, a blank tab), all actions stay
//     disabled and the user is told why — nothing is faked.
//  2. Load the per-origin toggle from the background (storage.local).
//  3. Toggling ON requests host permission for THAT origin only via
//     chrome.permissions.request(). If the user denies, the toggle reverts.
//     Toggling OFF removes the permission and tells the content script
//     (if injected) to remove its buttons.
//  4. "Check connection" is the ONLY thing that claims connected/disconnected,
//     and only from a live ping reply via the background. Default = unknown.
//  5. "Send this page link" / "Scan" are explicit user actions.
//  6. If the native host fails, a separate "Download with browser instead"
//     button appears. Clicking it is a second, explicit choice — the popup
//     never falls back to a browser download on its own.

'use strict';

const $ = (id) => document.getElementById(id);

let currentTab = null;
let currentOrigin = null;
let lastFailedUrl = null;

function setResult(text, ok) {
  const el = $('result');
  el.textContent = text || '';
  el.className = 'result' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}

function renderStatus(status) {
  const pill = $('statusPill');
  const detail = $('statusDetail');
  pill.className = 'pill ' + (status.status || 'unknown');
  if (status.status === 'connected') {
    pill.textContent = 'Connected';
    detail.textContent = status.hostVersion
      ? 'Desktop app replied to a live ping (version: ' + status.hostVersion + ').'
      : 'Desktop app replied to a live ping.';
  } else if (status.status === 'disconnected') {
    pill.textContent = 'Disconnected';
    detail.textContent = 'Not connected: ' + (status.error || 'native host unreachable.')
      + ' See native-host/PAIRING.md for install steps.';
  } else if (status.status === 'unknown') {
    pill.textContent = 'Unknown';
    detail.textContent = status.error || 'Not checked yet.';
  } else {
    pill.textContent = 'Unknown';
    detail.textContent = 'Not checked yet.';
  }
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

async function init() {
  // The popup itself has no stored status to show until a check runs:
  // "unknown" is the honest default, not a placeholder for "connected".
  renderStatus({ status: 'unknown' });

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs && tabs[0] ? tabs[0] : null;
  if (!currentTab || !currentTab.url || !isHttpUrl(currentTab.url)) {
    $('siteLine').textContent = currentTab && currentTab.url
      ? 'This page (' + currentTab.url.split(':')[0] + ':) cannot be scanned or sent.'
      : 'No web page is active.';
    $('siteToggle').disabled = true;
    return;
  }

  currentOrigin = originOf(currentTab.url);
  $('siteLine').textContent = currentOrigin;
  $('siteToggle').disabled = false;
  $('sendPageBtn').disabled = false;
  $('scanBtn').disabled = false;

  const setting = await chrome.runtime.sendMessage({ type: 'GET_SITE_SETTING', origin: currentOrigin });
  $('siteToggle').checked = !!(setting && setting.enabled);

  // Surface the last context-menu outcome (if any) so a failed send is visible.
  const last = await chrome.runtime.sendMessage({ type: 'GET_LAST_SEND' });
  if (last && !last.ok) {
    setResult('Last send failed: ' + (last.error || 'unknown error'), false);
  }
}

$('siteToggle').addEventListener('change', async () => {
  if (!currentOrigin || !currentTab) return;
  const wantOn = $('siteToggle').checked;
  if (wantOn) {
    // Ask for this origin only — never for <all_urls> up front.
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [currentOrigin + '/*'] });
    } catch (err) {
      setResult('Permission request failed: ' + err.message, false);
    }
    if (!granted) {
      $('siteToggle').checked = false;
      setResult('Permission for ' + currentOrigin + ' was not granted. Site stays off.', false);
      return;
    }
  } else {
    try { await chrome.permissions.remove({ origins: [currentOrigin + '/*'] }); } catch { /* best effort */ }
    try { await chrome.tabs.sendMessage(currentTab.id, { type: 'DM_SET_ENABLED', enabled: false }); } catch { /* not injected: nothing to remove */ }
  }
  const res = await chrome.runtime.sendMessage({ type: 'SET_SITE_SETTING', origin: currentOrigin, enabled: wantOn });
  if (!res || !res.ok) {
    $('siteToggle').checked = !wantOn;
    setResult('Could not save the site setting.', false);
  } else {
    setResult(wantOn ? 'Enabled for ' + currentOrigin + '.' : 'Disabled for ' + currentOrigin + '. Buttons removed.', true);
  }
});

$('checkBtn').addEventListener('click', async () => {
  $('checkBtn').disabled = true;
  $('checkBtn').textContent = 'Checking…';
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    renderStatus(status || { status: 'unknown', error: 'No reply from background.' });
  } catch (err) {
    renderStatus({ status: 'disconnected', error: err.message });
  } finally {
    $('checkBtn').disabled = false;
    $('checkBtn').textContent = 'Check connection';
  }
});

$('scanBtn').addEventListener('click', async () => {
  if (!currentTab || !$('siteToggle').checked) {
    setResult('Enable the site toggle first, then scan.', false);
    return;
  }
  setResult('Scanning…', null);
  const res = await chrome.runtime.sendMessage({ type: 'INJECT_CONTENT_SCRIPT', tabId: currentTab.id });
  if (!res || !res.ok) {
    setResult('Could not scan this page: ' + ((res && res.error) || 'unknown error'), false);
    return;
  }
  setResult('Scan started. Eligible links now show a “⬇ DM” button — click one to send it.', true);
});

$('sendPageBtn').addEventListener('click', async () => {
  if (!currentTab || !currentTab.url) return;
  await sendUrl(currentTab.url, currentTab.url);
});

async function sendUrl(url, pageUrl) {
  lastFailedUrl = null;
  $('browserDownloadBtn').hidden = true;
  setResult('Sending to desktop app…', null);
  const res = await chrome.runtime.sendMessage({ type: 'SEND_TO_APP', url, pageUrl });
  if (res && res.ok) {
    setResult('Sent to the desktop app.', true);
    try { await chrome.action.setBadgeText({ text: '' }); } catch { /* best effort */ }
  } else {
    lastFailedUrl = url;
    setResult('Not sent: ' + ((res && res.error) || 'unknown error'), false);
    // Only now, after an explicit failure, offer the browser fallback.
    $('browserDownloadBtn').hidden = false;
  }
}

$('browserDownloadBtn').addEventListener('click', async () => {
  if (!lastFailedUrl) return;
  const res = await chrome.runtime.sendMessage({ type: 'BROWSER_DOWNLOAD', url: lastFailedUrl });
  if (res && res.ok) {
    setResult('Downloading with the browser instead (download id ' + res.downloadId + ').', true);
    $('browserDownloadBtn').hidden = true;
  } else {
    setResult('Browser download failed: ' + ((res && res.error) || 'unknown error'), false);
  }
});

document.addEventListener('DOMContentLoaded', init);
