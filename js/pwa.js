/* Yours — PWA bootstrap
   ------------------------------------------------------------
   Registers the service worker and wires up the shared
   "installed?" helpers used by index.html (install gate) and
   install.html (install page).

   Exposes:
   - window.YoursPWA.isInstalled()  -> true when running as the
     installed app (standalone display mode or iOS standalone).
   - window.YoursPWA.onInstallPrompt(cb) -> fires cb with the
     captured beforeinstallprompt event (Android/Chrome).
*/
(function () {
  'use strict';

  function isInstalled() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia) {
      try {
        var ios = window.matchMedia('(display-mode: fullscreen)').matches ||
                  window.matchMedia('(display-mode: minimal-ui)').matches;
        if (ios) return true;
      } catch (e) { /* ignore */ }
    }
    if (navigator.standalone === true) return true; // iOS Safari
    return false;
  }

  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (typeof window.onYoursInstallPrompt === 'function') {
      window.onYoursInstallPrompt(e);
    }
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    if (typeof window.onYoursAppInstalled === 'function') {
      window.onYoursAppInstalled();
    }
  });

  function promptInstall() {
    if (!deferredPrompt) return Promise.resolve({ outcome: 'unavailable' });
    return deferredPrompt.prompt().then(function () {
      return deferredPrompt.userChoice;
    }).then(function (choice) {
      deferredPrompt = null;
      return choice || { outcome: 'unknown' };
    }).catch(function () {
      deferredPrompt = null;
      return { outcome: 'error' };
    });
  }

  window.YoursPWA = {
    isInstalled: isInstalled,
    canPromptInstall: function () { return !!deferredPrompt; },
    promptInstall: promptInstall,
    onInstallPrompt: function (cb) {
      window.onYoursInstallPrompt = cb;
      if (deferredPrompt) cb(deferredPrompt);
    }
  };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* registration failures must never block the app */
      });
    });
  }
})();
