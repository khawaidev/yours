/* Yours — desktop handling
   ------------------------------------------------------------
   Desktop visitors (>= 768px) get a full desktop experience:

   1. index.html (mobile swipe feed) redirects desktop users to
      desktop-index.html — the Discover page inside the shared
      desktop shell (css/desktop.css + js/desktop-ui.js).
   2. The create funnel lives on desktop-create.html plus the
      desktop-create-stage2..5.html pages.
   3. Every other app page injects the same sidebar via its
      <div id="ds-sidebar"></div> host; auth and onboarding
      pages stay sidebar-free.
   4. ysNotify()/ysOpenChat() stay defined so existing pages that
      call them keep working; they simply fall back to plain
      navigation into messaging.html.

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
