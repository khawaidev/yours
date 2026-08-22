/* Yours — desktop handling
   ------------------------------------------------------------
   The old multi-pane desktop shell has been removed. What remains:

   1. Desktop-width visitors landing on the feed are sent to
      desktop-index.html, a standalone page that hands the
      experience off to their smartphone via a QR code.
   2. ysNotify()/ysOpenChat() stay defined so existing pages that
      call them keep working; with no shell around they simply
      fall back to plain navigation.

   Phones (<768px) are never redirected.
*/
(function () {
  'use strict';

  function isDesktopWidth() {
    return window.innerWidth >= 768;
  }

  function pageName() {
    return (window.location.pathname.split('/').pop() || 'index.html');
  }

  if (isDesktopWidth() && pageName() === 'index.html') {
    window.location.replace('desktop-index.html');
    return;
  }

  function ysNotify(type, payload) {
    if (window.parent && window.parent !== window &&
        typeof window.parent.postMessage === 'function') {
      window.parent.postMessage({ ys: type, payload: payload }, '*');
    }
  }

  // No pane host exists anymore: always navigate normally.
  window.ysOpenChat = function (c) {
    try { sessionStorage.setItem('yours_current_character', JSON.stringify(c)); } catch (e) { /* ignore */ }
    window.location.href = 'messaging.html';
  };

  window.ysNotify = ysNotify;
})();
