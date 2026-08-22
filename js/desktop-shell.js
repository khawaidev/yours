/* Yours — Desktop / tablet support
   ------------------------------------------------------------
   Loaded on the main pages. Responsibilities:

   1. Detect whether we are running inside the desktop shell (an
      iframe pane) or as a standalone top-level page.
   2. On standalone desktop/tablet screens, route the app into the
      desktop shell (desktop.html) so users get the multi-column
      layout instead of a phone column. Signed-out (guest) users
      may only land on the index page or the auth page — every
      other page bounces them to the auth page.
   3. Expose ysNotify() so pages hosted in a pane can tell the shell
      what happened (a chat was opened, back was pressed, ...).

   Phones (<768px) are never redirected and never restructured.
*/
(function () {
  'use strict';

  var params = typeof URLSearchParams !== 'undefined' ? new URLSearchParams(window.location.search) : null;

  function inPane() {
    return window.self !== window.top || (params != null && params.get('pane') === '1');
  }

  function isDesktopWidth() {
    return window.innerWidth >= 768;
  }

  /* Synchronous signed-in check against the persisted Supabase session.
     Good enough for routing decisions; pages confirm with a real
     getSession() call where accuracy matters. */
  function hasStoredSession() {
    var keys = [
      'supabase.auth.token',
      'sb-dgbxcakkqrgrapwsvrol-auth-token',
      'sb-dgbxcakkqrgrapwsvrol-auth-token-code-verifier'
    ];
    for (var i = 0; i < keys.length; i++) {
      var raw = null;
      try { raw = localStorage.getItem(keys[i]); } catch (e) {}
      if (!raw) { try { raw = sessionStorage.getItem(keys[i]); } catch (e) {} }
      if (!raw) continue;
      try {
        var s = JSON.parse(raw);
        s = s.currentSession || s;
        if (s && typeof s.access_token === 'string') return true;
      } catch (e) { /* fall through */ }
      if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) return true;
    }
    return false;
  }

  function pageName() {
    return (window.location.pathname.split('/').pop() || 'index.html');
  }

  // Pages guests may open; everything else funnels to the auth page.
  var GUEST_ALLOWED = {
    'index.html': 1,
    'auth.html': 1,
    'desktop.html': 1,
    'cookie-policy.html': 1,
    'privacy-policy.html': 1,
    'terms.html': 1,
    'community-guidelines.html': 1,
    'legal.html': 1,
    'features.html': 1
  };

  // Standalone pages that become panes of the desktop shell.
  var SHELL_MAP = {
    'index.html': '',
    'Discover.html': 'discover',
    'chat.html': 'chat',
    'messaging.html': 'chat',
    'user-profile.html': 'profile',
    'settings.html': 'settings',
    'character-profile.html': 'discover'
  };

  if (isDesktopWidth()) {
    var page = pageName();
    // Discover.html may render inside a shell pane for signed-out users
    // (the guest home shows feeds + discover); standalone visits bounce.
    var paneOk = inPane() && page === 'Discover.html';
    if (!hasStoredSession() && !Object.prototype.hasOwnProperty.call(GUEST_ALLOWED, page) && !paneOk) {
      // Signed-out users can only browse feeds/discover or sign up.
      // Bounce the whole window (this may be running inside a shell pane).
      var top = window.top && window.top !== window ? window.top : window;
      try { top.location.replace('auth.html'); } catch (e) { window.location.replace('auth.html'); }
      return;
    }
    if (!inPane() && Object.prototype.hasOwnProperty.call(SHELL_MAP, page)) {
      var q = SHELL_MAP[page] ? ('?page=' + SHELL_MAP[page]) : '';
      window.location.replace('desktop.html' + q);
      return;
    }
  }

  if (inPane()) {
    // Mark the document so desktop.css can turn this page into a pane.
    document.documentElement.classList.add('ys-pane');
    window.ysPane = true;
  }

  /* Desktop-only QR gate for the feed: signed in or not, the index page
     inside the shell is blurred and replaced by a QR code handing the
     experience off to the visitor's smartphone. No other page in the
     shell gets this treatment. */
  if (inPane() && isDesktopWidth() && pageName() === 'index.html') {
    var mountQrGate = function () {
      if (!document.body || document.getElementById('ys-qr-gate')) return;

      var style = document.createElement('style');
      style.textContent =
        '#ys-qr-gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(8,8,12,.6);backdrop-filter:blur(18px) saturate(120%);-webkit-backdrop-filter:blur(18px) saturate(120%);' +
        "font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;}" +
        '.ys-qr-card{display:flex;flex-direction:column;align-items:center;gap:22px;padding:38px 44px;border-radius:28px;' +
        'background:rgba(20,20,26,.92);border:1px solid rgba(255,255,255,.08);box-shadow:0 30px 80px rgba(0,0,0,.55);' +
        'max-width:min(86vw,420px);text-align:center;}' +
        '.ys-qr-frame{padding:14px;background:#fff;border-radius:20px;box-shadow:0 12px 34px rgba(0,0,0,.45);}' +
        '.ys-qr-frame img{display:block;width:220px;height:220px;object-fit:contain;}' +
        '.ys-qr-text{margin:0;color:#f4f4f6;font-size:17px;font-weight:700;line-height:1.5;}';
      document.head.appendChild(style);

      var gate = document.createElement('div');
      gate.id = 'ys-qr-gate';
      gate.setAttribute('role', 'dialog');
      gate.setAttribute('aria-label', 'Continue on your smartphone');
      gate.innerHTML =
        '<div class="ys-qr-card">' +
          '<div class="ys-qr-frame"><img alt="Yours QR code" src="Assets/qrcode.png"></div>' +
          '<p class="ys-qr-text">Enjoy the full experience of the all in your smart phone</p>' +
        '</div>';
      document.body.appendChild(gate);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountQrGate);
    else mountQrGate();
  }

  function ysNotify(type, payload) {
    if (window.parent && window.parent !== window &&
        typeof window.parent.postMessage === 'function') {
      window.parent.postMessage({ ys: type, payload: payload }, '*');
    }
  }

  // Open a chat inside the shell: persist the character and tell the shell
  // to swap the main pane to messaging. Falls back to plain navigation.
  window.ysOpenChat = function (c) {
    try { sessionStorage.setItem('yours_current_character', JSON.stringify(c)); } catch (e) { /* ignore */ }
    if (window.ysPane) { ysNotify('open-chat', c); return; }
    window.location.href = 'messaging.html';
  };

  window.ysNotify = ysNotify;
})();
