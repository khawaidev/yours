/**
 * Binary media storage.
 *
 * Primary: OPFS (Origin Private File System) — fast, private, on-device.
 * Fallback: IndexedDB Blob store (`blobs` table) for browsers without OPFS.
 *
 * Generated images/videos/voice notes never leave the device.
 */
(function () {
  var ROOT_DIR = 'yours-media';

  function extForMime(mimeType, fallback) {
    var m = String(mimeType || '').toLowerCase();
    if (m.indexOf('image/png') === 0) return 'png';
    if (m.indexOf('image/webp') === 0) return 'webp';
    if (m.indexOf('image/gif') === 0) return 'gif';
    if (m.indexOf('image/jpeg') === 0) return 'jpg';
    if (m.indexOf('video/mp4') === 0) return 'mp4';
    if (m.indexOf('video/webm') === 0) return 'webm';
    if (m.indexOf('video/quicktime') === 0) return 'mov';
    if (m.indexOf('audio/mpeg') === 0) return 'mp3';
    if (m.indexOf('audio/mp4') === 0) return 'm4a';
    if (m.indexOf('audio/wav') === 0) return 'wav';
    if (m.indexOf('audio/ogg') === 0) return 'ogg';
    return fallback || 'bin';
  }

  function safeName(id, ext) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.' + ext;
  }

  function opfsSupported() {
    return !!(navigator.storage && navigator.storage.getDirectory);
  }

  async function rootDir(create) {
    var root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(ROOT_DIR, { create: !!create });
  }

  async function writeOpfs(name, blob) {
    var dir = await rootDir(true);
    var handle = await dir.getFileHandle(name, { create: true });
    var writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
  }

  async function readOpfs(name) {
    var dir = await rootDir(false);
    var handle = await dir.getFileHandle(name, { create: false });
    return handle.getFile();
  }

  async function removeOpfs(name) {
    try {
      var dir = await rootDir(false);
      await dir.removeEntry(name);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function writeIdb(id, blob) {
    if (!window.YoursDB) throw new Error('Local database unavailable');
    await window.YoursDB.blobs.put({ id: id, blob: blob, createdAt: Date.now() });
  }

  async function readIdb(id) {
    if (!window.YoursDB) return null;
    var row = await window.YoursDB.blobs.get(id);
    return row ? row.blob : null;
  }

  async function removeIdb(id) {
    if (!window.YoursDB) return false;
    try {
      await window.YoursDB.blobs.delete(id);
      return true;
    } catch (e) {
      return false;
    }
  }

  var OpfsStorage = {
    isOpfsSupported: opfsSupported,
    extForMime: extForMime,

    /**
     * Persist a Blob for a media id. Returns a storage descriptor:
     *   { storage: 'opfs'|'idb', path, mimeType, sizeBytes }
     */
    async save(id, blob, mimeType, preferredExt) {
      var ext = extForMime(mimeType, preferredExt);
      var name = safeName(id, ext);
      if (opfsSupported()) {
        try {
          await writeOpfs(name, blob);
          return { storage: 'opfs', path: name, mimeType: mimeType, sizeBytes: blob.size, ext: ext };
        } catch (err) {
          console.warn('[OpfsStorage] OPFS write failed, falling back to IndexedDB:', err && err.message);
        }
      }
      await writeIdb(id, blob);
      return { storage: 'idb', path: id, mimeType: mimeType, sizeBytes: blob.size, ext: ext };
    },

    /** Read the Blob for a media record (or a raw media id). */
    async getBlob(mediaOrId) {
      var media = typeof mediaOrId === 'string' ? { id: mediaOrId } : (mediaOrId || {});
      var id = media.id;
      if (!id) return null;

      if (media.storage === 'opfs' && media.path) {
        try { return await readOpfs(media.path); } catch (e) {}
      }
      // Storage descriptor missing or stale: probe both backends.
      if (opfsSupported()) {
        var ext = media.ext || extForMime(media.mimeType);
        try { return await readOpfs(safeName(id, ext)); } catch (e) {}
        // Legacy media rows may not have recorded an extension.
        var guesses = ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mp3', 'm4a', 'ogg', 'wav'];
        for (var i = 0; i < guesses.length; i++) {
          try {
            var found = await readOpfs(safeName(id, guesses[i]));
            if (found) return found;
          } catch (e2) {}
        }
      }
      return readIdb(id);
    },

    async remove(mediaOrId) {
      var media = typeof mediaOrId === 'string' ? { id: mediaOrId } : (mediaOrId || {});
      var id = media.id;
      if (!id) return false;
      var removed = false;
      if (opfsSupported() && media.path) removed = (await removeOpfs(media.path)) || removed;
      removed = (await removeIdb(id)) || removed;
      return removed;
    },

    /** Create a temporary object URL for a media record. Caller must revoke it. */
    async objectUrl(mediaOrId) {
      var blob = await this.getBlob(mediaOrId);
      if (!blob) return null;
      return URL.createObjectURL(blob);
    },
  };

  window.OpfsStorage = OpfsStorage;
})();
