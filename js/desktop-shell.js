/* Yours — cross-page helpers
   ------------------------------------------------------------
   The desktop version of the site has been removed: every
   visitor installs Yours as a PWA from install.html, so there
   is no desktop redirect or desktop shell anymore.

   These two helpers remain because several pages call them:

   - ysNotify(type, payload): posts a message to the parent
     frame (kept for embedded/iframed usage).
   - ysOpenChat(character): stores the picked character and
     navigates to messaging.html.
*/
(function () {
  'use strict';

  function ysNotify(type, payload) {
    if (window.parent && window.parent !== window &&
        typeof window.parent.postMessage === 'function') {
      window.parent.postMessage({ ys: type, payload: payload }, '*');
    }
  }

  window.ysOpenChat = function (c) {
    try { sessionStorage.setItem('yours_current_character', JSON.stringify(c)); } catch (e) { /* ignore */ }
    window.location.href = 'messaging.html';
  };

  window.ysNotify = ysNotify;
})();
