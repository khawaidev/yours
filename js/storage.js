/**
 * Local storage bootstrap: open the database, request persistence, surface
 * quota usage, and expose a single init() used by app pages.
 */
(function () {
  var readyPromise = null;
  var isPersistent = false;
  var lastError = null;

  async function estimate() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      var e = await navigator.storage.estimate();
      return {
        usage: e.usage || 0,
        quota: e.quota || 0,
        percent: e.quota ? Math.round(((e.usage || 0) / e.quota) * 100) : 0,
      };
    } catch (err) {
      return null;
    }
  }

  async function requestPersistence() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return false;
      var already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (already) { isPersistent = true; return true; }
      isPersistent = await navigator.storage.persist();
      return isPersistent;
    } catch (err) {
      return false;
    }
  }

  async function openDb() {
    if (!window.YoursDB) throw new Error('Local database failed to load');
    await window.YoursDB.open();
    return window.YoursDB;
  }

  function initialize() {
    if (readyPromise) return readyPromise;
    readyPromise = (async function () {
      try {
        await openDb();
        await requestPersistence();
        return { ok: true, persistent: isPersistent, estimate: await estimate() };
      } catch (err) {
        lastError = err;
        console.error('[YoursStorage] initialization failed:', err);
        return { ok: false, error: err, persistent: false, estimate: null };
      }
    })();
    return readyPromise;
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  /** Surface a friendly message for storage failures. */
  function describeError(err) {
    if (!err) return 'Storage error';
    if (err.name === 'QuotaExceededError' || /quota/i.test(err.message || '')) {
      return 'Your device is out of storage space. Free up space or delete some media and try again.';
    }
    return err.message || String(err);
  }

  window.YoursStorage = {
    initialize: initialize,
    requestPersistence: requestPersistence,
    estimate: estimate,
    formatBytes: formatBytes,
    describeError: describeError,
    isPersistent: function () { return isPersistent; },
    lastError: function () { return lastError; },
  };
})();
