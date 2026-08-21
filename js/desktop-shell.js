/* Yours — Desktop / tablet support
   ------------------------------------------------------------
   Loaded on the main pages. Responsibilities:

   1. Detect whether we are running inside the desktop shell (an
      iframe pane) or as a standalone top-level page.
   2. On standalone desktop/tablet screens, route the app into the
      desktop shell (desktop.html) so users get the two/three-column
      layout instead of a phone column.
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

  if (inPane()) {
    // Mark the document so desktop.css can turn this page into a pane.
    document.documentElement.classList.add('ys-pane');
    window.ysPane = true;
  } else if (window.innerWidth >= 768) {
    var page = (window.location.pathname.split('/').pop() || 'index.html');
    var map = {
      'index.html': '',
      'Discover.html': 'discover',
      'chat.html': 'chat',
      'messaging.html': 'chat',
      'user-profile.html': 'profile',
      'settings.html': 'settings'
    };
    if (Object.prototype.hasOwnProperty.call(map, page)) {
      var q = map[page] ? ('?page=' + map[page]) : '';
      window.location.replace('desktop.html' + q);
      return;
    }
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